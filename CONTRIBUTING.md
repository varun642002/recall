# Contributing to recall

## The one rule

No dependencies. A PR that adds one needs to say what it buys.

## Setup

```bash
git clone https://github.com/varun642002/recall && cd recall && node test/smoke.mjs
```

There is no build step.

## Before a PR

```bash
node test/smoke.mjs
```

Tests write to a temp directory and never touch your real transcripts. CI runs
them on Linux, macOS and Windows against Node 18, 20 and 22.

## Things to know

- **Stream, never read whole files.** Single transcripts reach hundreds of MB.
- **Most transcripts are not conversations.** Tool-generated transcripts can
  outnumber real sessions 20:1. They are excluded by default; keep it that way.
- **Resumed sessions duplicate history.** The same turn lands in several files,
  so identical turns are collapsed before being reported.
- **Noise filtering belongs in one place.** System reminders, sidechains and
  command wrappers are stripped in `lib/index.mjs`, not in the CLI.
