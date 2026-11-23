<div align="center">

# 🔎 recall

### grep across every Claude Code session you've ever had

*"When did I fix that CORS bug?" — now answerable.*

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue.svg)](package.json)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#)
[![Tests](https://img.shields.io/badge/tests-22-success.svg)](test/smoke.mjs)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

Every conversation you've had with Claude Code is sitting in `~/.claude/projects`
as JSONL. The answer to that problem you solved three months ago is in there.
There is no way to search it.

```console
$ recall cloud run deploy --mine

─── C:\work\erp 2026-11-14
  you  …the deploy to [cloud run] fails with "container failed to start",
       the port is 8080 but the app binds 3000…

─── C:\work\api 2026-09-02
  you  …can you set up a [cloud run deploy] from source instead of pushing
       an image to Artifact Registry…

  2 match(es) across 2 session(s), 29 searched
```

🔒 Runs entirely locally. Reads your transcripts, sends nothing anywhere.

## 🚀 Install

```bash
npx github:varun642002/recall cors error
```

Or clone it — there's nothing to build:

```bash
git clone https://github.com/varun642002/recall && node recall/bin/recall.mjs "my query"
```

## 🎮 Usage

```bash
recall cors error
```

Plain words must **all** appear. Use quotes for an exact phrase:

```bash
recall "docker compose"
```

| Flag | Effect |
|---|---|
| `--mine` | Only your messages |
| `--theirs` | Only Claude's replies |
| `--project TEXT` | Only sessions whose path contains TEXT |
| `--since DATE` / `--until DATE` | Date range (`YYYY-MM-DD`) |
| `--regex` | Treat the query as a regular expression |
| `--case` | Case-sensitive |
| `--context N` | Show N turns of surrounding conversation |
| `--limit N` | Max matches (default 40) |
| `--files` | List matching sessions with counts, not the matches |
| `--open` | Print each match's transcript path |
| `--duplicates` | Don't collapse turns repeated by resumed sessions |
| `--subagents` | Also search subagent and workflow transcripts |
| `--all` | Also search machine-generated transcripts |
| `--json` | Machine-readable output |

## 💡 What it's good for

| Question | Command |
|---|---|
| "How did I solve this before?" | `recall "connection refused"` |
| "What did I ask about auth?" | `recall auth --mine` |
| "What did Claude say about migrations?" | `recall migration --theirs` |
| "Everything from that week" | `recall deploy --since 2026-09-01 --until 2026-09-07` |
| "Which sessions touched Stripe?" | `recall stripe --files` |
| "Any TODOs left lying around?" | `recall 'TODO\|FIXME' --regex` |

## 🧭 Two things that make results usable

Both were found by running this against a real machine, and both matter if you
build anything on these transcripts.

**1. Most transcripts aren't conversations.** Tools that summarise your sessions
write transcripts of their own. On the machine this was built against, they
outnumbered real sessions **671 to 29** and buried every result. They're
excluded by default, along with subagent and workflow transcripts. `--all` and
`--subagents` bring them back.

**2. Resuming a session copies its history into a new file.** The same message
ends up on disk several times, so one message would be reported as three hits.
Identical turns are collapsed and the count is reported; `--duplicates` disables
it.

Transcripts are streamed line by line — single files reach hundreds of
megabytes — so searching gigabytes stays fast and flat in memory.

## 🤝 Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). No dependencies, please.

Ideas worth building:

- [ ] An index for instant search instead of a full scan
- [ ] Fuzzy matching
- [ ] Search inside tool calls and their results, not just conversation text
- [ ] An interactive picker that opens the session at the match

## 📄 License

[MIT](LICENSE)
