/* ================================================================
   keyboard — reach the creatures without a mouse.

   Both scenes put their whole point inside a <canvas>: pick a
   creature, read its details. That was pointer-only, which means the
   reef and the trench were unusable by keyboard — you could tab to
   the sort buttons and never touch a single coin.

   A canvas has no children to tab through, so the arrangement is the
   standard one for a composite widget: the canvas itself takes focus
   once, and arrow keys move a selection *within* it. Each move is
   announced through a live region, because a sighted-mouse cue like a
   glowing blob says nothing to a screen reader.
   ================================================================ */

/** left-to-right, top-to-bottom over whatever is currently visible */
export function readingOrder(items) {
  return [...items].sort((a, b) =>
    Math.abs(a.y - b.y) > 1.2 ? b.y - a.y : a.x - b.x);
}

/**
 * Nearest neighbour in a direction, preferring things that are actually
 * that way rather than merely closest — a creature slightly left and far
 * up is not what "right" should land on.
 */
export function neighbour(items, from, dir) {
  const axis = dir === "left" || dir === "right" ? "x" : "y";
  const sign = dir === "right" || dir === "up" ? 1 : -1;
  let best = null;
  let bestCost = Infinity;
  for (const it of items) {
    if (it.id === from.id) continue;
    const along = (it[axis] - from[axis]) * sign;
    if (along <= 0.001) continue;                       // wrong side
    const across = Math.abs(it[axis === "x" ? "y" : "x"] - from[axis === "x" ? "y" : "x"]);
    const cost = along + across * 2.5;                  // drifting sideways is expensive
    if (cost < bestCost) { bestCost = cost; best = it; }
  }
  return best;
}

/**
 * Wire a canvas up as a composite widget.
 *
 *   items()    -> [{ id, x, y }]  currently visible, in world space
 *   onFocus(id, item)             highlight it (and move the camera)
 *   onActivate(id, item)          enter/space — the equivalent of a click
 *   describe(id, item)            a sentence for the live region
 *   onEscape()                    optional
 */
export function mountSceneKeyboard(canvas, { items, onFocus, onActivate, describe, onEscape, status }) {
  let cursor = null;

  const announce = (msg) => { if (status) status.textContent = msg; };

  const moveTo = (item, { announceIt = true } = {}) => {
    if (!item) return false;
    cursor = item.id;
    onFocus?.(item.id, item);
    if (announceIt) announce(describe?.(item.id, item) ?? "");
    return true;
  };

  const first = () => {
    const list = readingOrder(items());
    return list.find((i) => i.id === cursor) ?? list[0];
  };

  canvas.addEventListener("keydown", (e) => {
    const list = items();
    if (!list.length) return;

    const dirs = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    if (e.key in dirs) {
      const from = list.find((i) => i.id === cursor);
      // the first arrow press picks a starting creature rather than moving
      const target = from ? neighbour(list, from, dirs[e.key]) ?? from : first();
      if (moveTo(target)) e.preventDefault();
      return;
    }

    if (e.key === "Enter" || e.key === " ") {
      const item = list.find((i) => i.id === cursor) ?? first();
      if (item) {
        moveTo(item, { announceIt: false });
        onActivate?.(item.id, item);
        e.preventDefault();
      }
      return;
    }

    if (e.key === "Home" || e.key === "End") {
      const list2 = readingOrder(list);
      if (moveTo(e.key === "Home" ? list2[0] : list2.at(-1))) e.preventDefault();
      return;
    }

    if (e.key === "Escape") { onEscape?.(); cursor = null; }
  });

  // arriving by tab should say what this is and how it works, once
  canvas.addEventListener("focus", () => {
    if (cursor) return;
    announce(`${items().length} creatures. arrow keys to move between them, enter to open one.`);
  });

  return {
    get cursor() { return cursor; },
    announce,
    clear() { cursor = null; },
  };
}
