#!/usr/bin/env node
// Dependency-free tests. Run: node test/smoke.mjs
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { findTranscripts, readTurns, matcher, textOf } from "../lib/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "bin", "recall.mjs");

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}\n      ${e.message}`);
    failed++;
  }
};
const eq = (a, b, m) => {
  if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error(`${m || "mismatch"}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};
const ok = (v, m) => {
  if (!v) throw new Error(m || "expected truthy");
};

console.log("matching");

check("all plain words must appear", () => {
  const m = matcher("cors error");
  ok(m.test("a CORS error happened"), "both present");
  ok(!m.test("a cors problem"), "second term missing");
});

check("matching ignores case by default", () => {
  ok(matcher("CORS").test("cors"), "insensitive");
  ok(!matcher("CORS", { caseSensitive: true }).test("cors"), "sensitive");
});

check("quoted phrases stay together", () => {
  const m = matcher('"docker compose"');
  eq(m.terms, ["docker compose"], "terms");
  ok(m.test("ran docker compose up"), "phrase present");
  ok(!m.test("docker and compose"), "words apart should not match");
});

check("regex mode works", () => {
  const m = matcher("TODO|FIXME", { regex: true });
  ok(m.test("a FIXME here"), "alternation");
  ok(!m.test("nothing"), "no match");
});

check("find returns match positions", () => {
  ok(matcher("cat").find("a cat and a cat").length === 2, "two positions");
});

console.log("content extraction");

check("text comes out of string and block content", () => {
  eq(textOf("plain"), "plain", "string");
  eq(textOf([{ type: "text", text: "a" }, { type: "tool_use" }, { type: "text", text: "b" }]), "a\nb", "blocks");
  eq(textOf(null), "", "null");
});

console.log("transcripts");

const dir = mkdtempSync(join(tmpdir(), "recall-test-"));
const proj = join(dir, "C--demo");
const subs = join(proj, "subagents");
const bots = join(dir, "C--Users-x--claude-mem-observer-sessions");
mkdirSync(subs, { recursive: true });
mkdirSync(bots, { recursive: true });

const turn = (role, text, extra = {}) =>
  JSON.stringify({
    type: role,
    sessionId: extra.session || "s1",
    cwd: "C:\\demo",
    timestamp: extra.ts || "2026-03-01T00:00:00.000Z",
    isSidechain: !!extra.side,
    message: { role, content: text },
  });

writeFileSync(
  join(proj, "a.jsonl"),
  [
    turn("user", "how do I fix the cors error"),
    turn("assistant", "add an Access-Control header"),
    turn("user", "<system-reminder>ignore me</system-reminder>"),
    turn("assistant", "unrelated chatter", { side: true }),
    "{{ not json",
    "",
  ].join("\n")
);
// A resumed session: the same turn copied into a second file.
writeFileSync(join(proj, "b.jsonl"), [turn("user", "how do I fix the cors error", { session: "s2" })].join("\n"));
writeFileSync(join(subs, "c.jsonl"), [turn("user", "cors in a subagent")].join("\n"));
writeFileSync(join(bots, "d.jsonl"), [turn("user", "cors in a bot transcript")].join("\n"));

check("subagent and bot transcripts are excluded by default", () => {
  eq(findTranscripts(dir).length, 2, "only real transcripts");
});

check("--subagents includes subagent transcripts", () => {
  eq(findTranscripts(dir, { includeSubagents: true }).length, 3, "with subagents");
});

check("--all includes machine-generated transcripts", () => {
  eq(findTranscripts(dir, { includeBots: true }).length, 3, "with bots");
});

const turns = [];
for await (const t of readTurns(join(proj, "a.jsonl"))) turns.push(t);

check("reads only real conversation turns", () => {
  eq(turns.length, 2, "count");
  eq(turns[0].role, "user", "first role");
});

check("skips system reminders, sidechains and bad lines", () => {
  ok(!turns.some((t) => t.text.includes("ignore me")), "reminder leaked");
  ok(!turns.some((t) => t.text.includes("unrelated")), "sidechain leaked");
});

check("carries cwd and session through", () => {
  eq(turns[0].cwd, "C:\\demo", "cwd");
  eq(turns[0].session, "s1", "session");
});

console.log("cli");

const run = (args) => {
  try {
    return execFileSync(process.execPath, [CLI, ...args, "--projects", dir], {
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
    });
  } catch (e) {
    return (e.stdout || "") + (e.stderr || "");
  }
};

check("finds a match", () => {
  ok(run(["cors"]).includes("match(es)"), "no summary line");
});

check("collapses turns repeated by a resumed session", () => {
  const out = run(["cors", "--mine"]);
  ok(out.includes("1 match"), `expected 1 match, got:\n${out}`);
  ok(out.includes("collapsed"), "should report the collapse");
});

check("--duplicates keeps them", () => {
  ok(run(["cors", "--mine", "--duplicates"]).includes("2 match"), "should keep both");
});

check("--mine and --theirs filter by speaker", () => {
  ok(run(["header", "--theirs"]).includes("1 match"), "assistant hit");
  ok(run(["header", "--mine"]).includes("no matches"), "should not match user");
});

check("--files lists sessions", () => {
  ok(run(["cors", "--files"]).includes("session(s) matched"), "files mode");
});

check("--json emits valid JSON", () => {
  const o = JSON.parse(run(["cors", "--json"]));
  ok(o.hits.length >= 1, "hits");
  eq(o.query, "cors", "query");
});

check("a miss exits non-zero and says so", () => {
  ok(run(["zzzznotpresent"]).includes("no matches"), "message");
});

check("--since and --until filter", () => {
  ok(run(["cors", "--since", "2027-01-01"]).includes("no matches"), "since excludes");
  ok(run(["cors", "--until", "2027-01-01"]).includes("match(es)"), "until includes");
});

check("--project filters by path", () => {
  ok(run(["cors", "--project", "demo"]).includes("match(es)"), "match");
  ok(run(["cors", "--project", "nothing"]).includes("no matches"), "no match");
});

check("a bad regex fails cleanly", () => {
  ok(run(["(unclosed", "--regex"]).includes("bad pattern"), "should report");
});

rmSync(dir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
