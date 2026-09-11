/* ================================================================
   visual — compare a screenshot against a committed baseline.

   Byte equality is the wrong test. Three runs of a provably identical
   scene still differ by ~18 pixels out of a million, each off by one
   in a single channel: text antialiasing over a blended backdrop
   rounds differently, and no amount of clock control fixes that.

   So: compare with a tolerance, and fail on the size of the change
   rather than its existence. A real regression moves thousands of
   pixels, not eighteen.

   The decoding happens inside Chrome, which already has a png decoder
   and an image compositor — so this stays dependency-free too.
   ================================================================ */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export const TOLERANCE = {
  channel: 2,        // per-channel delta to ignore (antialiasing rounding)
  maxPercent: 0.05,  // share of pixels allowed to differ before it's a regression
};

/** diff two png buffers inside the browser; returns counts, not pictures */
export async function diffPng(page, a, b, channelTol = TOLERANCE.channel) {
  return page.eval(`
    const decode = async (b64) => {
      const blob = await (await fetch("data:image/png;base64," + b64)).blob();
      const img = await createImageBitmap(blob);
      const c = new OffscreenCanvas(img.width, img.height);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      return { d: ctx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
    };
    const A = await decode(${JSON.stringify(a.toString("base64"))});
    const B = await decode(${JSON.stringify(b.toString("base64"))});
    if (A.w !== B.w || A.h !== B.h) {
      return { sizeMismatch: true, a: [A.w, A.h], b: [B.w, B.h] };
    }
    let differing = 0, maxDelta = 0;
    let minX = A.w, minY = A.h, maxX = -1, maxY = -1;
    for (let i = 0; i < A.d.length; i += 4) {
      const dr = Math.abs(A.d[i] - B.d[i]);
      const dg = Math.abs(A.d[i+1] - B.d[i+1]);
      const db = Math.abs(A.d[i+2] - B.d[i+2]);
      const worst = Math.max(dr, dg, db);
      if (worst > maxDelta) maxDelta = worst;
      if (worst > ${channelTol}) {
        differing++;
        const px = (i / 4) % A.w, py = Math.floor((i / 4) / A.w);
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
    }
    const total = A.w * A.h;
    return {
      differing, total, maxDelta,
      percent: +(100 * differing / total).toFixed(4),
      box: maxX < 0 ? null : [minX, minY, maxX, maxY],
      size: [A.w, A.h],
    };`);
}

/** compare a fresh capture to baselines/<name>.png, or lay one down */
export async function checkBaseline(page, dir, name, current, { update = false } = {}) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${name}.png`);

  if (update || !existsSync(path)) {
    writeFileSync(path, current);
    return { status: existsSync(path) && !update ? "created" : update ? "updated" : "created", path };
  }

  const result = await diffPng(page, readFileSync(path), current);
  if (result.sizeMismatch) {
    return { status: "fail", path, message: `size changed ${result.a.join("x")} → ${result.b.join("x")}` };
  }
  const ok = result.percent <= TOLERANCE.maxPercent;
  return {
    status: ok ? "pass" : "fail",
    path, ...result,
    message: ok
      ? `${result.differing} px differ (${result.percent}%) — within tolerance`
      : `${result.differing} px differ (${result.percent}%, max channel delta ${result.maxDelta})` +
        (result.box ? ` in region x${result.box[0]}-${result.box[2]} y${result.box[1]}-${result.box[3]}` : ""),
  };
}
