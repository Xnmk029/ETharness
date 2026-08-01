# pi-goosedump

`pi-goosedump` adds goosedump-backed session-history search, durable-memory
recall, entry expansion, and compaction to Pi. Its tools use the `goose_`
prefix.

## Install

```sh
pi install npm:pi-goosedump
```

The package installs `@jarkkojs/goosedump`, including native binaries for Linux
x64, macOS arm64, and Windows x64. If no compatible binary is available, the
extension keeps Pi's normal compaction behavior and its goosedump features
report that they are unavailable.

## Memory in a nutshell

1. **Remember:** [`gpt-oss-20b`](https://github.com/jarkkojs/goosedump/blob/main/docs/models/gpt-oss-20b.md)
   extracts typed, atomic statements with source provenance. [`bge-small-en-v1.5`](https://github.com/jarkkojs/goosedump/blob/main/docs/models/bge-small-en-v1.5.md)
   embeds each statement. SQLite stores the statements, vectors, and provenance.
2. **Recall:** lexical and entity matches come first. Cosine-similar BGE vectors
   fill the remaining slots. There is no separate vector database.

Explicit `goose_remember` requests and learning after successful compactions are
queued in the background, so model extraction and embedding do not block Pi.

## Tools

- **`goose_search`** ranks session messages and returns compact overviews with
  entry IDs.
- **`goose_get`** expands entry IDs returned by `goose_search` or `goose_grep`.
- **`goose_grep`** filters session messages with a glob pattern.
- **`goose_remember`** queues durable memory learning from a session. It defaults
  to the current Pi session and returns before extraction and embedding finish.
- **`goose_recall`** recalls typed memories with source provenance. It searches
  active memories in the current project by default; `history` includes
  superseded statements and `allProjects` searches every project.
- **`goose_compact`** starts asynchronous compaction of the current Pi session.
  `keep` preserves the last N user turns verbatim.
- **`goose_sessions`** lists or deletes sessions from the current working
  directory. The active session cannot be deleted.
- **`goose_forget`** deletes one memory or all retained sources from a session.
- **`goose_memory_status`** reports storage, embedding coverage, tombstones, and
  type counts.

Session-history tools default to the current Pi session and active lineage.
Non-Pi providers require an explicit session ID.

Examples:

```text
goose_search({ query: "bug fix" })
goose_search({ query: "auth", scope: "all", page: 2 })
goose_get({ ids: ["entry-a", "entry-b"] })
goose_grep({ pattern: "*timeout*" })
goose_recall({ query: "prior architecture decision" })
goose_recall({ query: "database", type: "decision" })
goose_recall({ query: "database", history: true })
goose_remember({})
goose_compact({ keep: 2 })
goose_sessions({ action: "list" })
goose_forget({ target: "mem_a1b2c3d4" })
goose_memory_status({})
```

## Commands

- **`/goose-search [query]`** searches the current session. A bare command opens
  an inline prompt; selecting a result expands it.
- **`/goose-compact [keep:N]`** compacts now. With `keep:N`, the last N user
  turns remain verbatim; without it, Pi chooses the cut point.
- **`/goose-sessions`** lists or deletes saved sessions scoped to the current working directory.
- **`/goose-forget [memory-id|provider:id]`** deletes stored durable memory by ID or session.
- **`/goose-memory-status`** displays durable-memory storage health and indexing counts.
- **`/goose-settings`** edits global and project compaction settings.

## Settings

Optional settings live under `goosedump` in:

- `~/.pi/agent/settings.json` for global settings.
- `.pi/settings.json` for project overrides.

```json
{
  "goosedump": {
    "turnsBeforeCompact": 0,
    "summaryMaxTokens": 4096
  }
}
```

`turnsBeforeCompact` is an integer from 0 to 255. `0` disables the turn-based
trigger. Pi's `compaction.enabled` setting controls all automatic compaction, including
the turn-based trigger. Each completed model response counts as one turn, including
responses that call tools. The countdown is restored when a session resumes and
appears in the footer with a status dot (green when >25% turns remain, yellow when
≤25%, red when ≤12.5%) followed by a hexadecimal countdown. `● GD:0A` means ten
turns remain, `● GD:00` is ready to compact, and `● GD:--` means the turn trigger is
disabled. The footer adds `queued` while compaction is waiting to start and
`compacting` while the summary is being built. When the counter hits zero mid
tool-loop, compaction starts immediately after the current tool batch is persisted
and the task is resumed automatically. When the counter hits zero on a terminal
turn, compaction starts after the agent has settled. Pi remains the scheduler for
its context threshold. Whichever enabled limit is reached first compacts once, and
every successful compaction resets the countdown. A failed or cancelled compaction
leaves the counter armed at zero and retries on the next tool turn or settlement.

`summaryMaxTokens` is an integer from 512 to 65536 (default 4096). The effective
summary budget is the lower of this value and 80% of Pi's `compaction.reserveTokens`,
leaving room for the next model response. Clearing a project value restores the
global setting.

## Compaction behavior

The extension uses `goosedump session compact` for manual, scheduled, and automatic
compaction. It preserves the previous summary, summarizes only the new range, and
passes the effective token budget. `keep:N` leaves the last N user turns verbatim.
Tool requests are queued until Pi is idle; if Pi reaches its context threshold
first, the queued request is coalesced into that compaction.

After success, memory learning is queued in the background. A learning failure
keeps the summary and displays a warning. Custom instructions use Pi's normal
compactor; other goosedump failures fall back to Pi.

## License

`pi-goosedump` is licensed under `Apache-2.0`. See [LICENSE](LICENSE).
