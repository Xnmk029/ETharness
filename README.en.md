# ETharness

**Agent MFT** — An Everything-style memory addressing layer for [Pi](https://pi.dev): filter-syntax addressing plus deterministic addresses, locating facts across memory backends with precision across sessions.

[中文文档](README.md)

## Overview

Most agent memory systems compete on extraction quality (model capability). ETharness differentiates on the engineering of memory **addressing, storage, and invocation** — the same way Everything relates to the Windows filesystem: it does not replace the file manager; it is an index layer mounted on top of it.

Research findings (details in [research/](research/)):

- Existing memory extensions (mem0, MemOS, MemPalace, pi-observational-memory, @chendpoc/pi-memory, and more) already cover storage, injection, compaction, and redaction
- **Still unimplemented anywhere**: Everything-style filter syntax, deterministic address references, rebuildable cross-session projections, and a memory browser
- ETharness builds only the gap: no storage, no injection, no compaction — only the addressing layer

## Features

- **Everything-style filter syntax**: `type:decision entity:auth since:2w imp:>0.6`, `#A1F3`, `--term` exclusion
- **Deterministic addresses**: stable short codes (`#A1F3`) for cross-session references; `mem_supersede` builds decision supersession chains
- **Rebuildable cross-session projection**: the mirror (SQLite) can be fully rebuilt from backends (`/mft:rebuild`); addresses stay stable and are never reused
- **Dual mirrors**: project-local (`.pi/agent-mft/mirror.sqlite`) + global (`~/.pi/agent/agent-mft/mirror.sqlite`) merged queries
- **First-turn injection**: rule-based evaluation decides whether to inject the memory map on the first turn (or manually via `/mft:inject`)
- **Zero native dependencies**: storage uses Node's built-in `node:sqlite` (WAL mode)

## Architecture

```
User / Agent
   |  mem_query "type:decision entity:auth since:2w"
   v
+----------------------------------------------+
| Agent MFT addressing layer (agent-mft)        |
|  - query engine  (query.ts, Everything syntax)|
|  - address system (addr.ts, deterministic)    |
|  - mirror        (mirror.ts, rebuildable)     |
|  - runtime       (runtime.ts, dual merge)     |
|  - tools/commands (mem_* tools, /mft cmds)    |
+--------+-------------+-------------+---------+
         |             |             |
   chendpoc adapter  obs adapter  manual adapter
   (MEMORY.md)    (session ledger) (mirror itself)
```

Design principle: **backends are the source of truth; the mirror is only a projection.** The mirror can be dropped and rebuilt at any time; the `backend_key -> addr` mapping stays stable across rebuilds, and addresses are never reused.

## Quick Start

```bash
# 1. Add agent-mft as a pi extension (or append the path to the extensions
#    list in ~/.pi/agent/settings.json)
pi install /absolute/path/to/agent-mft

# 2. Restart pi
# 3. Verify
/mft:stats
```

On first start with an empty mirror, the extension automatically rebuilds the projection from installed memory backends.

## Agent Tools

| Tool | Description |
|---|---|
| `mem_query {expr, limit?}` | Everything-style addressing query |
| `mem_get {addr}` | Expand a memory (metadata + backend source) |
| `mem_add {filename, kind, entity?, path?, importance?, content?}` | Record a durable memory, returns its address |
| `mem_supersede {old_addr, new_addr}` | Mark an old decision superseded |
| `mem_revoke {addr}` | Revoke a wrong/obsolete memory |

## User Commands

| Command | Description |
|---|---|
| `/mft <expr>` | Browse memories (filter, select, expand); Tab completes syntax |
| `/mft:add <text> [kind=decision] [entity=x] [imp=0.8]` | Manually record a memory |
| `/mft:inject` | Manually inject the memory map into the next turn |
| `/mft:rebuild` | Rebuild the mirror projection from backends |
| `/mft:stats` | Mirror statistics |

## Backend Adapters

| Backend | Source | Description |
|---|---|---|
| `chendpoc` | `~/.pi/pi-memory-data/MEMORY.md` + `auto-*.md` | Parses @chendpoc/pi-memory's cross-session Markdown ground truth (overflow files, `[user]` markers, section mapping) |
| `obs` | `~/.pi/agent/sessions/**/*.jsonl` | Parses pi-observational-memory's session ledger (observations/reflections) with source evidence replay |
| `manual` | mirror itself | Written directly by `mem_add` / `/mft:add`; preserved across rebuilds |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MFT_MEMORY_DIR` | `~/.pi/pi-memory-data` | chendpoc memory directory |
| `MFT_SESSIONS_DIR` | `~/.pi/agent/sessions` | pi sessions directory |
| `MFT_GLOBAL_DB` | `~/.pi/agent/agent-mft/mirror.sqlite` | global mirror path |

## Development

```bash
cd agent-mft
node --test    # 46 unit tests (Node 24 native TS, zero dependencies)
```

Requirements: Node.js >= 24 (`node:sqlite`), pi >= 0.83.

## Documentation

- [Design document](docs/DESIGN-PI.md) — v0.3 strategy and implementation design
- [Pi memory ecosystem](research/pi-memory-ecosystem.md) — landscape survey
- [Source deep-dive](research/pi-memory-deepdive.md) — pi-observational-memory & @chendpoc/pi-memory analysis
- [Model selection](research/model-selection-v4flash.md) — DeepSeek-V4-Flash-0731 evaluation
- [MCP memory ecosystem](research/mcp-memory-ecosystem.md) — general memory layer survey

## License

MIT
