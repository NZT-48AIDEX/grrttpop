/* ================================================================
   corpus — keeping the real days, and deciding which to let go.

   The snapshot feed produces a real market state and force-pushes it
   over the last one, so every day the site has ever seen is thrown
   away. Keeping them is what lets tomorrow's `lib/` run against
   yesterday's market — which is the only way to find out whether a
   judgement holds outside the one afternoon in `fixtures/`.

   Measured on 2026-09-22: github delivers ~15% of the cron's ticks,
   so this accumulates about six entries a day, not forty-eight. That
   killed the original "thin to 6-hourly" plan — at six a day there is
   nothing to thin — and left a simpler rule: keep everything recent,
   then one a week.

   Pure: names and dates in, a keep/drop decision out. The tool does
   the gzipping and the git.
   ================================================================ */

/*
 * Sizes, measured rather than guessed. The first real bundle was
 * **168KB gzipped** from ~532KB of json — 3.2x, not the 9x this plan
 * originally assumed. That one number moved the whole design: 14 days
 * at ~6 entries a day would be 14.5MB, over the cap, so the recent
 * window is a week and everything older is thinned.
 */
export const ENTRY_KB = 168;
/** a clone of the corpus branch should stay under this */
export const SIZE_CAP_MB = 10;

/*
 * A 10MB ceiling at 168KB an entry buys about 60 entries, so the
 * ladder is designed to spend exactly that rather than letting the
 * ceiling silently eat the oldest tier:
 *
 *   everything for 3 days   ~19 entries   debuggable at the hour
 *   one a day for 30        ~27 entries   a month of regimes
 *   one a week for 180      ~21 entries   seasons, cheaply
 *                           ~67, trimmed to fit by the ceiling
 *
 * Fine grain where you need to reproduce a specific moment, coarse
 * grain where you only need variety — calibration wants different
 * markets far more than it wants six samples of one afternoon.
 */
export const KEEP_ALL_DAYS = 3;
export const DAILY_DAYS = 30;
export const WEEKLY_DAYS = 180;

const pad = (n) => String(n).padStart(2, "0");

/** `2026-09-23T0430Z.json.gz` — sorts lexically, reads as a date */
export function entryName(at = new Date()) {
  const d = new Date(at);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
         `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z.json.gz`;
}

export function entryDate(name) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})Z\.json\.gz$/.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
}

/** iso week, so "one a week" means a real week and not a rolling 7 days */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // thursday decides the year, per iso 8601
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - jan1) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${pad(week)}`;
}

const MONTH = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
const DAY = (d) => d.toISOString().slice(0, 10);

/**
 * What to keep.
 *
 * A ladder: everything recent, then one a day, then one a week, then
 * one a month. Within a bucket the *earliest* entry wins — the kept
 * set must not churn as new entries arrive, or every prune rewrites
 * history and the branch stops being diffable.
 *
 * Then a hard ceiling, because a ladder bounds growth in principle and
 * bytes are what a clone actually pays. Over the cap, the oldest and
 * coarsest go first; the recent window is defended last, since that is
 * the part you cannot reconstruct from anywhere else.
 */
export function retain(names = [], {
  now = Date.now(),
  keepAllDays = KEEP_ALL_DAYS,
  dailyDays = DAILY_DAYS,
  weeklyDays = WEEKLY_DAYS,
  sizes = null,
  capBytes = SIZE_CAP_MB * 1024 * 1024,
} = {}) {
  const day = 86_400_000;
  /* each rung: how far back it reaches, and what counts as "the same
     bucket" within it. the last rung has no limit. */
  const ladder = [
    { name: "recent", until: keepAllDays * day, bucket: null },
    { name: "daily", until: dailyDays * day, bucket: DAY },
    { name: "weekly", until: weeklyDays * day, bucket: isoWeek },
    { name: "monthly", until: Infinity, bucket: MONTH },
  ];

  const dated = names
    .map((name) => ({ name, at: entryDate(name) }))
    .filter((e) => e.at)
    .sort((a, b) => a.at - b.at);

  const keep = [], drop = [], why = new Map(), tier = new Map();
  const seen = new Map();

  for (const e of dated) {
    const age = now - +e.at;
    const rung = ladder.find((r) => age <= r.until) ?? ladder[ladder.length - 1];
    if (!rung.bucket) {
      keep.push(e.name); why.set(e.name, "recent"); tier.set(e.name, "recent");
      continue;
    }
    const key = `${rung.name}:${rung.bucket(e.at)}`;
    if (seen.has(key)) {
      drop.push(e.name);
      why.set(e.name, `superseded in ${rung.bucket(e.at)}`);
    } else {
      seen.set(key, e.name);
      keep.push(e.name);
      why.set(e.name, `${rung.name} (${rung.bucket(e.at)})`);
      tier.set(e.name, rung.name);
    }
  }

  let bytes = keep.reduce((n, k) => n + (sizes?.[k] ?? ENTRY_KB * 1024), 0);
  let overCap = false;
  if (bytes > capBytes) {
    overCap = true;
    const oldestFirst = [...keep].sort((a, b) => entryDate(a) - entryDate(b));
    for (const pass of ["monthly", "weekly", "daily", "recent"]) {
      for (const name of oldestFirst) {
        if (bytes <= capBytes) break;
        const i = keep.indexOf(name);
        if (i < 0 || tier.get(name) !== pass) continue;
        keep.splice(i, 1);
        drop.push(name);
        why.set(name, `over the ${SIZE_CAP_MB}MB ceiling (oldest ${pass} goes first)`);
        bytes -= sizes?.[name] ?? ENTRY_KB * 1024;
      }
      if (bytes <= capBytes) break;
    }
  }

  return { keep, drop, why, tier, bytes, overCap, unnamed: names.filter((n) => !entryDate(n)) };
}

/** the corpus's own manifest, so a reader does not have to list a git branch */
export function corpusManifest({ entries = [], incidents = [], at = Date.now(), bytes = 0 } = {}) {
  const dates = entries.map(entryDate).filter(Boolean).sort((a, b) => a - b);
  return {
    what: "recorded upstream payloads, one bundle per snapshot run — the raw inputs the site saw",
    why: "so tomorrow's code can run against yesterday's market. fixtures/ is one afternoon; " +
         "this is every day the publisher managed to catch.",
    replay: "each bundle's `files` are keyed by the same names fixtures/ uses, so the same " +
            "replay shim reads both",
    generatedAt: new Date(at).toISOString(),
    entries: entries.length,
    oldest: dates.length ? dates[0].toISOString() : null,
    newest: dates.length ? dates[dates.length - 1].toISOString() : null,
    incidents: incidents.length,
    bytes,
    retention: `everything for ${KEEP_ALL_DAYS} days, then one a day to ${DAILY_DAYS}, ` +
               `one a week to ${WEEKLY_DAYS}, then one a month — under a ${SIZE_CAP_MB}MB ceiling`,
    caveats: [
      "sampling is whatever github's scheduler delivered — roughly six a day, unevenly spaced",
      "pushes cluster in working hours, so active days are over-sampled; each entry records its trigger",
      "each bundle carries 168 hourly prices per coin, so price history is dense even where sampling is not",
      "short-lived failures cannot be sampled for and are captured as incidents instead",
      "an entry holds what the publisher called, not every fixture: no wallet read, so " +
        "getBalance/getSlot/getTokenAccountsByOwner are absent. fixtures/ still owns those paths.",
    ],
  };
}
