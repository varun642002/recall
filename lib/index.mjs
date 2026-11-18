// Find and read Claude Code transcripts.
import { homedir } from "node:os";
import { join } from "node:path";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createInterface } from "node:readline";

export const PROJECTS = process.env.RECALL_PROJECTS || join(homedir(), ".claude", "projects");

/**
 * Directories whose transcripts are machine-generated rather than conversations
 * you had. Tools that summarise your sessions write their own transcripts, and
 * on a real machine they can outnumber genuine sessions 20:1 and bury every
 * result. Excluded unless --all is passed.
 */
const BOT_DIRS = [/observer-sessions/i, /claude-mem/i];

/**
 * Transcript files. Subagent and workflow transcripts are excluded by default:
 * they are machine chatter, and including them buries your own words.
 */
export function findTranscripts(
  root = PROJECTS,
  { includeSubagents = false, includeBots = false } = {}
) {
  const out = [];
  if (!existsSync(root)) return out;
  const isBot = (p) => BOT_DIRS.some((re) => re.test(p));
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (!includeSubagents && (e.name === "subagents" || e.name === "workflows")) continue;
        if (!includeBots && isBot(e.name)) continue;
        walk(p, depth + 1);
      } else if (e.name.endsWith(".jsonl")) {
        if (!includeSubagents && /[/\\](subagents|workflows)[/\\]/.test(p)) continue;
        if (!includeBots && isBot(p)) continue;
        out.push(p);
      }
    }
  };
  walk(root, 0);
  return out;
}

export function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

const NOISE = [
  "<system-reminder>",
  "<command-name>",
  "Caveat: The messages below",
  "[Request interrupted",
];

function isNoise(t) {
  return NOISE.some((n) => t.startsWith(n));
}

/**
 * Stream one transcript, yielding conversation turns.
 * Transcripts reach hundreds of MB, so nothing is read whole.
 */
export async function* readTurns(file, { includeSidechain = false } = {}) {
  let rl;
  try {
    rl = createInterface({
      input: createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
  } catch {
    return;
  }
  let cwd = "";
  let n = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.cwd && !cwd) cwd = e.cwd;
    if (!includeSidechain && e.isSidechain) continue;
    if (e.type !== "user" && e.type !== "assistant") continue;
    const msg = e.message;
    if (!msg || !msg.role) continue;
    const text = textOf(msg.content).trim();
    if (!text || isNoise(text)) continue;
    yield {
      role: msg.role,
      text,
      cwd,
      file,
      session: e.sessionId || "",
      ts: e.timestamp || "",
      n: n++,
    };
  }
  rl.close();
}

/** Compile a query into a matcher. Supports plain words, "quoted phrases" and --regex. */
export function matcher(query, { regex = false, caseSensitive = false } = {}) {
  if (regex) {
    const re = new RegExp(query, caseSensitive ? "g" : "gi");
    return {
      test: (t) => re.test(t),
      find: (t) => [...t.matchAll(new RegExp(re.source, re.flags))].map((m) => m.index),
      terms: [query],
    };
  }
  const terms = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(query))) terms.push(m[1] ?? m[2]);
  const norm = (s) => (caseSensitive ? s : s.toLowerCase());
  return {
    // All terms must appear — narrow beats noisy when searching your own history.
    test: (t) => {
      const h = norm(t);
      return terms.every((x) => h.includes(norm(x)));
    },
    find: (t) => {
      const h = norm(t);
      const idx = [];
      for (const x of terms) {
        const nx = norm(x);
        let i = h.indexOf(nx);
        while (i !== -1) {
          idx.push(i);
          i = h.indexOf(nx, i + nx.length);
        }
      }
      return idx.sort((a, b) => a - b);
    },
    terms,
  };
}

export function fileDay(file) {
  try {
    return new Date(statSync(file).mtime).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}
