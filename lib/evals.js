/* ================================================================
   evals — is this actually useful to an agent, or do we just think so?

   Every other signal here answers "is it correct". None of them
   answer "is it worth anything", and the usual way to find that out —
   watch what people do — is permanently closed to this site. No
   trackers is not a default here, it is a promise, and a worker must
   not log per-visitor either.

   So ask the site questions instead. Real ones, each with a checker,
   scored on three things:

     · could it be answered at all
     · how many calls it took
     · **what it cost**: a plain fetch, a clone, or a browser

   That last column is the whole point. A question that needs a
   headless chrome to answer is a question most agents will not ask,
   and the list of those is the backlog in priority order — the
   roadmap's recurring "what is missing for an agent", answering
   itself instead of being guessed at.

   Pure: results in, a scoreboard and a regression verdict out.
   ================================================================ */

/** cheapest first — the order is the ranking */
export const TIERS = ["feed", "site", "clone", "browser", "unanswerable"];
export const TIER_COST = Object.fromEntries(TIERS.map((t, i) => [t, i]));

export const TIER_WHAT = {
  feed: "a plain https fetch of the published snapshots",
  site: "a fetch of the site itself",
  clone: "the repo, node, and a network call",
  browser: "a headless browser",
  unanswerable: "nothing here answers it",
};

export function scoreboard(results = []) {
  const ran = results.filter((r) => !r.skipped);
  const answered = ran.filter((r) => r.ok);
  const byTier = {};
  for (const r of ran) byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;

  /* the backlog: everything an agent cannot get at without a clone or
     a browser, plus everything nothing answers at all */
  const expensive = ran
    .filter((r) => TIER_COST[r.tier] >= TIER_COST.clone)
    .sort((a, b) => TIER_COST[b.tier] - TIER_COST[a.tier]);

  return {
    total: results.length,
    ran: ran.length,
    skipped: results.length - ran.length,
    answered: answered.length,
    failed: ran.length - answered.length,
    calls: ran.reduce((n, r) => n + (r.calls ?? 0), 0),
    byTier,
    backlog: expensive.map((r) => ({ id: r.id, question: r.question, tier: r.tier })),
  };
}

/**
 * Compare a run against the committed scores.
 *
 * Only regressions fail. A question that got cheaper to answer, or one
 * nobody had asked before, is not a reason to go red — the point is to
 * notice the day something a fetch used to answer starts needing a
 * browser.
 */
export function compare(current = [], baseline = []) {
  const was = new Map(baseline.map((b) => [b.id, b]));
  const regressions = [], improvements = [], added = [], removed = [];

  for (const r of current) {
    if (r.skipped) continue;
    const b = was.get(r.id);
    if (!b) { added.push({ id: r.id, tier: r.tier, ok: r.ok }); continue; }

    if (b.ok && !r.ok) {
      regressions.push({ id: r.id, why: `was answerable, now: ${r.detail ?? "no answer"}` });
    } else if (TIER_COST[r.tier] > TIER_COST[b.tier]) {
      regressions.push({ id: r.id, why: `got more expensive: ${b.tier} → ${r.tier}` });
    } else if (TIER_COST[r.tier] < TIER_COST[b.tier]) {
      improvements.push({ id: r.id, why: `${b.tier} → ${r.tier}` });
    } else if (!b.ok && r.ok) {
      improvements.push({ id: r.id, why: "now answerable" });
    }
  }

  for (const b of baseline) {
    if (!current.some((r) => r.id === b.id)) removed.push({ id: b.id });
  }

  return { regressions, improvements, added, removed, ok: regressions.length === 0 };
}

/** what gets committed: the shape, never the answers — those change hourly */
export function baselineOf(results = []) {
  return results
    .filter((r) => !r.skipped)
    .map(({ id, tier, ok, calls }) => ({ id, tier, ok, calls }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
