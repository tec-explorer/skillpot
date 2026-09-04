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
- **Per-agent switch matrix** — `config.yaml` drives a symlink sync engine; flip switches in the GUI, the TUI, or the CLI
- **8 agents**: Claude Code, ZCode, Codex CLI, OpenCode, Gemini CLI, DeepSeek CLI (dsh), Cursor, Amp
- **Doctor**: broken links, drift, shadowed names, orphaned links — `--fix` repairs automatically
- **Security lint** on install: frontmatter integrity + dangerous script patterns (`rm -rf`, `curl | sh`, credential access, data exfiltration…)
- **Adopt** existing skills scattered across agent directories (copy or move mode)
- **Update** git-sourced skills in place (symlinks keep working, no re-linking) with file-level diffs
- **Market**: browse and one-click install from built-in sources — Anthropic, Vercel, Superpowers, Matt Pocock — or any custom git repo; search the skills.sh directory anonymously
- **Team alignment**: commit a `.skillpot.yaml` manifest, teammates run `skillpot sync` to match it
- **MCP bridge**: any MCP-capable agent can consume the central store, still filtered by the switch matrix
- **Broadcast mode**: expose a skill to the cross-tool `~/.agents/skills/` shared directory on demand

## Quick start

Requires Node ≥ 18.

```bash
npm install -g @tec-explorer/skillpot   # or: npx @tec-explorer/skillpot (alias: spot)

skillpot init                     # create ~/.skillpot and detect installed agents
skillpot adopt --dry-run          # preview: existing skills found in agent dirs
skillpot adopt --move             # adopt with move mode (original dir becomes a symlink)
skillpot gui                      # web console: matrix / doctor / adopt / install / market / maintain / team
skillpot add ~/demo/my-skill      # install a skill (exposed to no agent by default)
skillpot enable my-skill --for claude-code,codex
skillpot doctor                   # consistency check (--fix to repair)
skillpot search "commit message"  # search the skills.sh directory
skillpot install-search anthropics/skills/pdf   # install a directory result
skillpot sync                     # align with a project .skillpot.yaml manifest
```

> Agents scan their skill directories at session start — restart a session after enable/disable.

## How it works

```
~/.skillpot/
├── skills/<name>/SKILL.md   # central store: the single copy (self-contained, symlinks dereferenced)
├── config.yaml              # sources / checksums + the skill × agent switch matrix
├── state.json               # ledger of links this tool created (uninstall only touches these)
├── skillspot.lock.json      # machine-readable snapshot (team sharing / audit)
└── cache/market/            # clone cache for market sources
```

`enable` creates a symlink from the agent's skills directory into the central store — agents discover it on their next session scan. `disable` removes it. The tool only ever touches paths recorded in its own ledger.

Landing strategies per agent: **A** symlink (default) → **B** copy + resync (agents that don't follow symlinks) → **C** MCP bridge (universal fallback).

## Documentation

- [Feature guide (screenshots)](docs/guide.md) — Chinese, with screenshots of every surface
- [Design: agent adapters](docs/design/agent-adapters.md) · [Design: MCP bridge](docs/design/mcp-bridge.md) · [Product plan](docs/product/product-plan.md)

## Security

Skills are instructions injected into model context plus optionally executable scripts. SkillPot's defaults: install lints before exposing, nothing is exposed to any agent until you say so, uninstall/disable only touches ledgered paths, and the web console listens on 127.0.0.1 with token-gated writes. Report vulnerabilities via [SECURITY.md](SECURITY.md).

## Development

```bash
npm install
npm test          # vitest, sandboxed (never touches your real HOME)
npm run test:e2e  # sandboxed end-to-end smoke
npm run build     # typecheck + esbuild bundle + web GUI build
```

## License

[MIT](LICENSE)
