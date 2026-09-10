# SkillPot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@tec-explorer/skillpot)](https://www.npmjs.com/package/@tec-explorer/skillpot)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](package.json)

**The skill manager for coding agents — install once, expose per agent, update once.**

> Coding agents (Claude Code, ZCode, Codex, OpenCode, Gemini CLI, DeepSeek CLI, Cursor, Amp…) have converged on the same `SKILL.md` open standard, but each discovers skills from its own directory: a skill installed into `~/.claude/skills` only works for Claude Code. SkillPot keeps every skill in one central store and exposes it per agent via symlinks — with a switch matrix, consistency doctor, security lint, and team alignment.

[中文文档](README.md) ｜ 📖 [Feature guide with screenshots](docs/guide.md)

![GUI switch matrix](docs/images/gui-matrix.png)

## Why SkillPot

Registries and marketplaces (skills.sh, Anthropic marketplace) answer *"where do I find skills"* — they are the **upstream**. SkillPot answers *"where does it install, who sees it, how do I stop it, how do I update it"* — the **management layer**:

- **One central store** at `~/.skillpot/skills/` — a single source of truth with checksums and a lockfile
- **Per-target switch matrix** — `config.yaml` drives a symlink sync engine; flip switches in the GUI, the TUI, or the CLI
- **8 agents**: Claude Code, ZCode, Codex CLI, OpenCode, Gemini CLI, DeepSeek CLI (dsh), Cursor, Amp — plus the **universal broadcast column** (`~/.agents/skills/`) sitting in the matrix as a first-class target
- **Honest verification levels** — every target is labelled *live-verified* / *docs-confirmed* / *unverified*, so nothing unproven is presented as working
- **Doctor**: broken links, drift, shadowed names, orphaned links — `--fix` repairs automatically
- **Security lint** on install: frontmatter integrity + dangerous script patterns (`rm -rf`, `curl | sh`, credential access, data exfiltration…)
- **Adopt** existing skills scattered across agent directories (copy or move mode)
- **Update** git-sourced skills in place (symlinks keep working, no re-linking) with file-level diffs
- **Market**: browse and one-click install from built-in sources — Anthropic, Vercel, Superpowers, Matt Pocock — or any custom git repo; search the skills.sh directory anonymously
- **Team alignment**: commit a `.skillpot.yaml` manifest, teammates run `skillpot sync` to match it
- **MCP bridge**: any MCP-capable agent can consume the central store, still filtered by the switch matrix
- **Crash- and race-safe state**: atomic writes (temp file + rename) and an inter-process lock around every read-modify-write of config/ledger

## Quick start

Requires Node ≥ 18.

```bash
npm install -g @tec-explorer/skillpot   # or: npx @tec-explorer/skillpot (alias: spot)

skillpot init                     # create ~/.skillpot and detect installed agents
skillpot adopt --dry-run          # preview: existing skills found in agent dirs
skillpot adopt --move             # adopt with move mode (original dir becomes a symlink)
skillpot gui                      # web console: matrix / doctor / adopt / install / market / maintain / team
skillpot add ~/demo/my-skill      # install a skill (exposed to no target by default)
skillpot enable my-skill --for claude-code,codex
skillpot enable my-skill --for broadcast   # universal broadcast into ~/.agents/skills
skillpot doctor                   # consistency check (--fix to repair)
skillpot search "commit message"  # search the skills.sh directory
skillpot install-search anthropics/skills/pdf   # install a directory result
skillpot sync                     # align with a project .skillpot.yaml manifest
```

> Agents scan their skill directories at session start — restart a session after enable/disable.
> `--for all` expands to every concrete agent and **excludes the broadcast column** — broadcasting is opt-in only.

## How it works

```
~/.skillpot/
├── skills/<name>/SKILL.md   # central store: the single copy (self-contained, symlinks dereferenced)
├── config.yaml              # sources / checksums + the skill × target switch matrix
├── state.json               # ledger of links this tool created (uninstall only touches these)
├── skillpot.lock.json       # machine-readable snapshot (team sharing / audit)
└── cache/market/            # clone cache for market sources
```

`enable` creates a symlink from the target directory into the central store — agents discover it on their next session scan. `disable` removes it. The tool only ever touches paths recorded in its own ledger.

Matrix columns come in two kinds: concrete **agents** (`claude-code`, `codex`, …) and the **universal broadcast** channel (`broadcast` → `~/.agents/skills/`). The channel is coarse-grained — every agent honouring that convention sees it and it cannot be switched off per agent — so it is never implied by `--for all`.

Landing strategies per agent: **A** symlink (default) → **B** copy + resync (agents that don't follow symlinks) → **C** MCP bridge (universal fallback).

## Documentation

- [Feature guide (screenshots)](docs/guide.md) — Chinese, with screenshots of every surface
- [Design: agent adapters](docs/design/agent-adapters.md) · [Design: MCP bridge](docs/design/mcp-bridge.md) · [Product plan](docs/product/product-plan.md)

## Security

Skills are instructions injected into model context plus optionally executable scripts. SkillPot's defaults:

- **Pre-install security block**: deep scans `SKILL.md` body (prompt injection, hidden HTML comment payloads, Unicode zero-width obfuscation, Base64 exec, dynamic remote fetch) and lifecycle hooks; blocks on `error` before saving to disk unless `--force` (`-f`) is given.
- **Full audit & CI gate**: `audit` scans all physical files across agent directories for unmanaged skills; supports `--ci` / `--fail-on <level>` with non-zero exit code as CI gates.
- Install lints before exposing; nothing is exposed to any target until you say so.
- Uninstall/disable only touches ledgered paths.
- Web console listens on 127.0.0.1 with token-gated writes.

Two defaults worth knowing about:

- The **universal broadcast column is excluded from `--for all`** — it writes into the cross-tool shared directory, so it can never be undone per agent. The TUI skips that column in its row-wide toggle and the GUI asks for confirmation before bulk-enabling it.
- The **MCP bridge fixes agent identity via the `SKILLPOT_AGENT` env var**; a `tools/call` argument cannot widen what `list`, `search`, or `read` can see.

Report vulnerabilities via [SECURITY.md](SECURITY.md).


## Development

```bash
npm install
npm test          # vitest, sandboxed (never touches your real HOME)
npm run test:e2e  # sandboxed end-to-end smoke
npm run build     # typecheck + esbuild bundle + web GUI build
```

## License

[MIT](LICENSE)
