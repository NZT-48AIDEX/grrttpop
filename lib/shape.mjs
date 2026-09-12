/* ================================================================
   shape — what a response looks like, ignoring what it says.

   A fixture freezes an API's *shape*. Prices change every minute and
   that is fine; a renamed field is not. This reduces a response to the
   set of key paths and their types, so two can be compared without the
   values getting in the way.

   Deliberately dependency-free and pure, so it is unit-tested like
   everything else in lib/.
   ================================================================ */

const typeOf = (v) =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v;

const union = (a, b) =>
  [...new Set([...a.split("|"), ...b.split("|")])].filter((t) => t !== "null").sort().join("|") || "null";

/**
 * Flatten a value into path -> type.
 *
 * Arrays collapse to a single `[]` segment and are sampled rather than
 * enumerated: a 50-coin response has one coin *shape*, not fifty. The
 * sample is a union across elements, because APIs omit or null-out
 * fields on some rows and reading only the first would invent drift.
 */
export function shapeOf(value, { maxDepth = 8, sample = 12 } = {}) {
  const out = new Map();

  const walk = (v, path, depth) => {
    const t = typeOf(v);
    if (path) {
      const prev = out.get(path);
      // null on one row and a number on another is a nullable number,
      // not a conflict
      out.set(path, prev && prev !== t ? union(prev, t) : (prev ?? t));
    }
    if (depth >= maxDepth) return;

    if (t === "array") {
      for (const item of v.slice(0, sample)) walk(item, `${path}[]`, depth + 1);
    } else if (t === "object") {
      for (const [k, child] of Object.entries(v)) {
        walk(child, path ? `${path}.${k}` : k, depth + 1);
      }
    }
  };

  walk(value, "", 0);
  return out;
}

/**
 * Compare two shapes. `removed` is the one that matters: a field the
 * recording had and the live response doesn't is something the site may
 * be reading. `added` is almost always harmless. `changed` is a type
 * flip — the quiet dangerous one, since a number that became a string
 * still renders, just wrongly.
 */
export function compareShapes(recorded, live) {
  const removed = [];
  const added = [];
  const changed = [];

  for (const [path, type] of recorded) {
    if (!live.has(path)) removed.push(path);
    else if (live.get(path) !== type) changed.push({ path, from: type, to: live.get(path) });
  }
  for (const path of live.keys()) if (!recorded.has(path)) added.push(path);

  return { removed, added, changed, same: !removed.length && !changed.length };
}

/**
 * Which of these paths does the code actually read?
 *
 * A heuristic on purpose: it looks for the leaf key name as a whole word
 * in the given sources. That can match a coincidence, so it over-reports
 * rather than under-reports — when deciding whether to wake someone, a
 * false alarm beats a missed rename.
 */
export function referencedBy(paths, sources) {
  const hits = new Map();
  for (const path of paths) {
    const leaf = path.split(".").pop().replace(/\[\]$/, "");
    if (!leaf || leaf.length < 3) continue;
    const safe = leaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const where = [];
    for (const [name, src] of Object.entries(sources)) {
      if (new RegExp(`\\b${safe}\\b`).test(src)) where.push(name);
    }
    if (where.length) hits.set(path, where);
  }
  return hits;
}
