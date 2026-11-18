#!/usr/bin/env node
// recall — grep across every Claude Code session you have ever had.
import { findTranscripts, readTurns, matcher, PROJECTS, fileDay } from "../lib/index.mjs";

// Colour helpers are defined first: they are used by top-level code below, and
// `const` would otherwise be in its temporal dead zone after an await.
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\u001b[${code}m${s}\u001b[0m` : s);
const bold = c("1");
const dim = c("2");
const cyan = c("36");
const yellow = c("33");
const hl = (s) => (tty ? `\u001b[43m\u001b[30m${s}\u001b[0m` : `[${s}]`);

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = "") => {
  const i = argv.indexOf(f);
  return i === -1 ? d : (argv[i + 1] ?? d);
};

if (!argv.length || has("--help") || has("-h")) {
  console.log(`recall — search every Claude Code session you have ever had

usage: recall <query> [options]

  recall cors error
  recall "docker compose" --project api
  recall 'TODO|FIXME' --regex --mine

options:
  --project TEXT     only sessions whose path contains TEXT
  --since DATE       only sessions on or after YYYY-MM-DD
  --until DATE       only sessions on or before YYYY-MM-DD
  --mine             only your messages, not Claude's
  --theirs           only Claude's messages
  --regex            treat the query as a regular expression
  --case             case-sensitive
  --context N        lines of surrounding conversation (default 0)
  --limit N          maximum matches (default 40)
  --files            list matching sessions only, with counts
  --open             print the transcript path for each match
  --subagents        also search subagent and workflow transcripts
  --all              also search machine-generated transcripts (claude-mem etc)
  --duplicates       do not collapse turns repeated by resumed sessions
  --json             machine-readable output
  --projects DIR     transcripts directory

Plain words must ALL appear. Use "quotes" for a phrase.`);
  process.exit(argv.length ? 0 : 1);
}

const query = argv.filter((a, i) => !a.startsWith("--") && !isFlagValue(i)).join(" ");
function isFlagValue(i) {
  const prev = argv[i - 1];
  return (
    prev &&
    ["--project", "--since", "--until", "--context", "--limit", "--projects"].includes(prev)
  );
}

if (!query.trim()) {
  console.error("recall: nothing to search for (try --help)");
  process.exit(1);
}

const root = val("--projects") || PROJECTS;
const limit = Number(val("--limit", "40")) || 40;
const ctx = Number(val("--context", "0")) || 0;
const projectFilter = val("--project").toLowerCase();
const since = val("--since");
const until = val("--until");
const onlyMine = has("--mine");
const onlyTheirs = has("--theirs");

let m;
try {
  m = matcher(query, { regex: has("--regex"), caseSensitive: has("--case") });
} catch (e) {
  console.error(`recall: bad pattern — ${e.message}`);
  process.exit(1);
}

const files = findTranscripts(root, {
  includeSubagents: has("--subagents"),
  includeBots: has("--all"),
});
if (!files.length) {
  console.error(`recall: no transcripts in ${root}`);
  process.exit(1);
}

const hits = [];
const perFile = new Map();
let searched = 0;
let truncated = false;
const showDuplicates = has("--duplicates");
const seenTurns = new Set();
let collapsed = 0;

outer: for (const file of files) {
  const day = fileDay(file);
  if (since && day && day < since) continue;
  if (until && day && day > until) continue;

  const window = [];
  searched++;
  for await (const turn of readTurns(file, { includeSidechain: has("--subagents") })) {
    if (projectFilter && !turn.cwd.toLowerCase().includes(projectFilter)) break;
    const tday = (turn.ts || "").slice(0, 10) || day;
    if (since && tday && tday < since) continue;
    if (until && tday && tday > until) continue;

    if (ctx) {
      window.push(turn);
      if (window.length > ctx + 1) window.shift();
    }

    const roleOk = onlyMine ? turn.role === "user" : onlyTheirs ? turn.role === "assistant" : true;
    if (!roleOk) continue;
    if (!m.test(turn.text)) continue;

    // Resuming a session copies its earlier turns into a NEW transcript file,
    // so the same message is on disk several times and would be reported as
    // several hits. Collapse identical turns unless --duplicates is asked for.
    if (!showDuplicates) {
      const key = turn.role + "\u0000" + turn.text;
      if (seenTurns.has(key)) {
        collapsed++;
        continue;
      }
      seenTurns.add(key);
    }

    perFile.set(file, (perFile.get(file) || 0) + 1);
    hits.push({ ...turn, before: ctx ? window.slice(0, -1).map(summarise) : [] });
    if (hits.length >= limit) {
      truncated = true;
      break outer;
    }
  }
}

if (has("--json")) {
  console.log(JSON.stringify({ query, searched, matches: hits.length, truncated, hits }, null, 2));
  process.exit(hits.length ? 0 : 1);
}

if (has("--files")) {
  if (!perFile.size) {
    console.log(`no matches for "${query}" in ${searched} session(s)`);
    process.exit(1);
  }
  const rows = [...perFile.entries()].sort((a, b) => b[1] - a[1]);
  console.log();
  for (const [f, c] of rows) {
    console.log(`  ${String(c).padStart(4)}  ${f}`);
  }
  console.log(`\n  ${rows.length} session(s) matched\n`);
  process.exit(0);
}

if (!hits.length) {
  console.log(`no matches for "${query}" in ${searched} session(s)`);
  process.exit(1);
}

console.log();
let lastKey = "";
for (const h of hits) {
  const key = h.session + h.cwd;
  if (key !== lastKey) {
    const day = (h.ts || "").slice(0, 10);
    console.log(`${dim("─".repeat(3))} ${bold(h.cwd || "(unknown)")} ${dim(day)}`);
    lastKey = key;
  }
  for (const b of h.before) console.log(dim(`    ${b}`));
  const who = h.role === "user" ? cyan("you") : yellow("claude");
  console.log(`  ${who}  ${excerpt(h.text)}`);
  if (has("--open")) console.log(dim(`        ${h.file}`));
  console.log();
}

const note = truncated ? ` (stopped at --limit ${limit})` : "";
const dupNote = collapsed ? `, ${collapsed} repeat(s) collapsed` : "";
console.log(
  `  ${hits.length} match(es) across ${perFile.size} session(s), ${searched} searched${dupNote}${note}\n`
);

// ---------- rendering ----------

function summarise(t) {
  const first = t.text.replace(/\s+/g, " ").slice(0, 100);
  return `${t.role === "user" ? "you" : "claude"}: ${first}${t.text.length > 100 ? "…" : ""}`;
}

/** A window around the first match, with the terms highlighted. */
function excerpt(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  const idx = m.find(flat);
  const at = idx.length ? idx[0] : 0;
  const start = Math.max(0, at - 60);
  const end = Math.min(flat.length, at + 160);
  let out = (start ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "");
  for (const term of m.terms) {
    if (!term) continue;
    try {
      const re = new RegExp(escape(term), has("--case") ? "g" : "gi");
      out = out.replace(re, (x) => hl(x));
    } catch {
      /* a regex query may not be a literal; leave it unhighlighted */
    }
  }
  return out;
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
