/* the report's job is to name one thing to do. its failure mode is
   reading as "all green" while half the loop does not exist. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { verdict, renderMarkdown, renderLine } from "../lib/report.js";

const S = (name, status, over = {}) => ({ name, status, headline: `${name} headline`, lines: [], ...over });

test("the verdict is the worst thing present", () => {
  assert.equal(verdict([S("a", "ok"), S("b", "warn")]).status, "warn");
  assert.equal(verdict([S("a", "ok"), S("b", "warn"), S("c", "fail")]).status, "fail");
  assert.equal(verdict([S("a", "ok")]).status, "ok");
});

test("it names one thing, failures first", () => {
  const v = verdict([S("fixtures", "warn"), S("suite", "fail"), S("feed", "warn")]);
  assert.equal(v.first, "suite", "a failure outranks a warning wherever it sits");
});

test("absent is a status, not a pass", () => {
  const v = verdict([S("suite", "ok"), S("corpus", "absent", { stage: 1 })]);
  assert.equal(v.status, "absent");
  assert.equal(v.first, "corpus");

  const md = renderMarkdown([S("suite", "ok"), S("corpus", "absent", { stage: 1 })]);
  assert.match(md, /not built yet/);
  assert.match(md, /roadmap stage 1/);
  assert.doesNotMatch(md, /Everything that exists is green/);
});

test("a section skipped on request is not the work", () => {
  const sections = [S("suite", "ok"), S("feed", "absent", { skipped: true }), S("corpus", "absent", { stage: 1 })];
  assert.equal(verdict(sections).first, "corpus", "nobody asked for the skipped one");
  const md = renderMarkdown(sections);
  assert.doesNotMatch(md, /- \*\*feed\*\*/, "skipped sections stay out of the backlog");
});

test("all green says so plainly", () => {
  const md = renderMarkdown([S("suite", "ok"), S("feed", "ok")]);
  assert.match(md, /Everything that exists is green/);
});

test("the one-line form carries the tally and the next thing", () => {
  const line = renderLine([S("suite", "ok"), S("feed", "fail")]);
  assert.match(line, /1 ok/);
  assert.match(line, /1 fail/);
  assert.match(line, /start here: feed/);
});

test("it reports rather than blocks, and says so", () => {
  assert.match(renderMarkdown([S("suite", "fail")]), /Reports rather than blocks/);
});

test("nothing at all is not a pass either", () => {
  assert.equal(verdict([]).status, "absent");
  assert.equal(verdict([]).first, null);
});
