> [!IMPORTANT]
> # Project Status: Development Suspended
>
> The resident memory architecture of this project relies on the long-lived KV cache mechanism of DeepSeek models (disk prefix caching, hit price $0.0028/M).
> Development is suspended pending the release of stronger models and verification of cache mechanism compatibility.
> The core architecture and implementation remain intact and can be resumed once models are ready.

# ETharness

**Agent MFT** — A memory addressing layer for [Pi](https://pi.dev). This project implements Everything-style filter syntax and deterministic addresses for cross-session, cross-backend memory retrieval in agent workflows.

[中文文档](README.md)

## Overview

Agent session memory is conventionally bounded by the context window; cross-session consistency relies on repeated restatement or summary compression. The core abstraction of this project is an independent memory addressing system. Its design objectives include:

- Locating memories through filter expressions across dimensions such as type, entity, path, time, importance, and status
- Assigning stable addresses to memories, enabling cross-session references and supersession tracking
- Unifying multiple memory backends through a rebuildable mirror projection (SQLite)
- Forming a stable prefix from a resident memory set, in conjunction with DeepSeek disk caching, for low-cost cross-session presence

The system is provided in two forms: a Pi extension (`agent-mft/`) and a graphical interface (`gui/`). The storage layer uses the Node built-in `node:sqlite` module with no native dependencies.

## Features

- **Filter syntax addressing**: `type:decision entity:auth since:2w imp:>0.6`, `#A1F3`, `--term` exclusion
- **Deterministic addresses**: Base36 short codes; addresses are never reused and remain stable across sessions
- **Rebuildable projection**: the mirror can be fully rebuilt from backends (chendpoc, obs, manual) with stable address mapping
- **Dual mirrors**: project-local (`.pi/agent-mft/mirror.sqlite`) and global (`~/.pi/agent/agent-mft/mirror.sqlite`) merged queries
- **Resident memory**: pinned or high-importance memories form a byte-stable prefix injected into the system prompt each turn
- **Cache telemetry**: records cache hit and miss tokens, estimating savings by model price delta
- **Creative memory kinds**: character, world, idea, material, plan, event, style

## Architecture

```
User / Agent
   |  mem_query "type:decision entity:auth since:2w"
   v
+-----------------------------------------------+
| Addressing layer (agent-mft)                    |
|  - query engine  (query.ts, filter syntax)      |
|  - address system (addr.ts, deterministic)      |
|  - mirror        (mirror.ts, SQLite, rebuildable)|
|  - runtime       (runtime.ts, dual merge)       |
|  - tools/commands (mem_* tools, /mft commands)  |
+---------+-------------+--------------+---------+
          |             |              |
   chendpoc adapter  obs adapter    manual adapter
   (MEMORY.md)     (session ledger)  (mirror itself)
```

Backends serve as the source of truth; the mirror is a projection that can be dropped and rebuilt at any time.

## Quick Start

```bash
# Install the extension (or append the path to the extensions list
# in ~/.pi/agent/settings.json)
pi install /absolute/path/to/agent-mft

# Restart Pi, then verify
/mft:stats
```

On first start with an empty mirror, the extension automatically rebuilds the projection from installed memory backends.

## Addressing Syntax

```
<expr> := <term> ( <space> <term> )*
<term> := <keyword>                  # filename substring match
        | type:<kind>                # memory kind
        | entity:<name>              # entity match
        | path:<a/b>                 # hierarchical prefix
        | backend:<obs|chendpoc|manual>
        | since:<1h|1d|2w|3m|1y>     # time window
        | imp:>0.7                   # importance comparison
        | status:active|superseded|revoked
        | #<ADDR>                    # deterministic address
        | --<term>                   # exclusion
```

Examples: `type:decision entity:auth since:2w`, `#A1F3`, `backend:chendpoc kind:preference`.

## Agent Tools

| Tool | Description |
|---|---|
| `mem_query {expr, limit?}` | Filter-syntax addressing query |
| `mem_get {addr}` | Expand a memory (metadata and backend source) |
| `mem_add {filename, kind, entity?, path?, importance?, content?}` | Record a durable memory; returns its address |
| `mem_supersede {old_addr, new_addr}` | Mark an old record superseded |
| `mem_revoke {addr}` | Revoke a record |
| `mem_pin {addr}` / `mem_unpin {addr}` | Join / leave the resident set |

## User Commands

| Command | Description |
|---|---|
| `/mft <expr>` | Browse memories (filter, select, expand); syntax completion supported |
| `/mft:add <text> [kind=decision] [entity=x] [imp=0.8]` | Manually record a memory |
| `/mft:pin <addr>` / `/mft:unpin <addr>` | Resident set management |
| `/mft:resident` | Show the resident set |
| `/mft:inject` | Manually inject the memory map |
| `/mft:rebuild` | Rebuild the mirror from backends |
| `/mft:stats` / `/mft:cache` | Mirror statistics / cache telemetry |

## Resident Memory and Caching

The resident set consists of pinned and high-importance records, ordered stably by address. The set is appended to the system prompt each turn with byte-level stability, satisfying the prefix-matching requirement of DeepSeek disk caching (hit: $0.0028/M, miss: $0.14/M, V4-Flash). Dynamic retrieval results are injected as a message on the first turn and do not affect the resident prefix.

Cache usage is collected from the `usage` field of `message_end` events; `/mft:cache` reports the hit rate and estimated savings by price delta.

## Graphical Interface

`gui/` provides a local interface with zero dependencies: a Pi RPC subprocess handles conversation, while the agent-mft kernel is imported directly (Node 24 type-stripping). The interface includes a memory browser (filters, tabs, pinning), streaming conversation, and a cache dashboard.

```bash
node gui/server.ts --project "G:/产品/harness"   # open http://127.0.0.1:8787
```

## Backend Adapters

| Backend | Source | Description |
|---|---|---|
| `chendpoc` | `~/.pi/pi-memory-data/MEMORY.md` + `auto-*.md` | Parses cross-session Markdown ground truth (overflow files, `[user]` markers, section mapping) |
| `obs` | `~/.pi/agent/sessions/**/*.jsonl` | Parses session ledger entries (observations / reflections) with evidence replay |
| `manual` | mirror itself | Written by `mem_add` / `/mft:add`; preserved across rebuilds |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MFT_MEMORY_DIR` | `~/.pi/pi-memory-data` | chendpoc memory directory |
| `MFT_SESSIONS_DIR` | `~/.pi/agent/sessions` | Pi sessions directory |
| `MFT_GLOBAL_DB` | `~/.pi/agent/agent-mft/mirror.sqlite` | global mirror path |
| `PI_CLI` | npm global path probe | Pi CLI location (GUI) |

## Development

```bash
cd agent-mft
node --test    # 53 unit tests (Node 24 native TypeScript)
```

Requirements: Node.js >= 24 (`node:sqlite`), Pi >= 0.83.

## Documentation

- [Design document](docs/DESIGN-PI.md)
- [Product positioning](docs/PRD.md)
- [GUI guide](gui/README.md)

## License

MIT
