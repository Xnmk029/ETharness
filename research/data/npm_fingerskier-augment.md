# augment

Local RAG memory for agentic work.
Memories are files story on your system (e.g. you could use a Dropbox directory for persistence).
The "retrieval" part is a local index used to find relevant memories when you need them.
Plugins for various agent tools so they know how to memorize and remember things.

## Quickstart

One package wires Augment into your agent. No clone, no build.

**Claude Code:**

```powershell
npx -y @fingerskier/augment install claude --scope user --memory-root "C:\Users\you\Dropbox\augment-memories"
```

**Codex:**

```powershell
npx -y @fingerskier/augment install codex --scope user --memory-root "C:\Users\you\Dropbox\augment-memories"
```

**Grok Build:**

```powershell
npx -y @fingerskier/augment install grok --scope user --memory-root "C:\Users\you\Dropbox\augment-memories"
```

**opencode:** add the plugin to `~/.config/opencode/opencode.json` or your repo's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "@fingerskier/augment",
      {
        "memoryRoot": "C:\\Users\\you\\Dropbox\\augment-memories"
      }
    ]
  ]
}
```

**Claude + Codex + Grok at once:**

```powershell
npx -y @fingerskier/augment install all --scope user --memory-root "C:\Users\you\Dropbox\augment-memories"
```

**Pi CLI:**

```powershell
pi install npm:@fingerskier/augment
```

Restart the agent and the `augment` memory tools appear.
For Grok, restart or press `r` in `/mcps` after install.
For opencode, quit and restart after saving config; config and plugins are loaded only at startup.
Swap `--scope user` (your home dir) for `--scope repo` to install into the current project.
Add `--dry-run` to preview every file write first.
Details: [Install Agent Integrations](#install-agent-integrations) and [Pi Package](#pi-package).

## CLI Commands

Run any command without a clone via `npx -y @fingerskier/augment <command>`:

| Command | What it does |
| --- | --- |
| `status` | Print the resolved config (memory root, state dir, daemon). Default command; `config` is an alias. |
| `dashboard` | Start the daemon (if needed) and open the memory graph web UI. `--no-open` just prints the URL. |
| `restart` | Stop the shared daemon (if running) and start a fresh one so config changes take effect. |
| `install <codex\|claude\|grok\|all>` | Wire Augment into an agent. See [Quickstart](#quickstart). |
| `recall "<task>"` | Print the memory that would be recalled for a task (what the hooks auto-inject). |
| `hook <event>` | Run a lifecycle hook over stdin JSON. Host-wired by `install`; you rarely call it directly. |
| `help` | Show full usage (also `--help`, `-h`). |

Examples:

```powershell
npx -y @fingerskier/augment status
npx -y @fingerskier/augment dashboard
npx -y @fingerskier/augment dashboard --no-open
npx -y @fingerskier/augment recall "fix the daemon reconnect bug" --project fingerskier/augment --limit 5
```

`status`, `dashboard`, and `recall` honor `AUGMENT_MEMORY_ROOT` /
`~/.augment/config.json`; `dashboard` also honors `AUGMENT_DAEMON_PORT`. Inside
this repo use the compiled bin instead — see
[Run Locally](#run-locally).

## Overview

Augment is durable, local, project-aware memory for coding agents.
It stores memories as plain markdown files, maintains a rebuildable local index, and serves them over an MCP server backed by a shared local daemon —
so several agents can share one memory folder without each running its own watcher/indexer.
Your memories stay on disk; nothing leaves the machine.

The point is to close the loop on every coding session:
1. **You prompt.**  The agent starts a task and searches Augment for relevant prior context.
2. **Memories retrieved.**  Governing specs, architecture decisions, known issues, and past work surface as direct context — no re-explaining what was already decided.
3. **Work done.**  The agent implements against that context instead of guessing.
4. **Memories updated.** Durable outcomes — requirements (`SPEC`), decisions (`ARCH`), descriptive knowledge (`INFO`), bugs (`ISSUE`), deferred work (`TODO`), milestones (`WORK`) — are written back and linked, ready for the next session.

Installed integrations enforce this loop with lifecycle hooks: relevant memory is
auto-injected at prompt and tool time, and a Stop hook prompts the end-of-turn
write-back — no reliance on the agent remembering.

Over time the memory folder becomes a project's institutional knowledge: 
queryable by semantic search, browsable as a graph in the [dashboard](#dashboard), and portable across machines via relative paths.
For example, you could set your memory-root at a Dropbox folder and use them on multiple machines-
paths and linkages are relative to that path so the search index is rebuildable and useable on multiple systems at once.

Generic memories live as ordinary files under `.generic/<KIND>/<name>.md`;
`decoction_glean` discovers recurring evidence and writes an agent-synthesized
INFO, SPEC, or ARCH. The separately approved
`decoction_cleanup` can remove only the originals the user selects. Dream
workflows use normal global search — prioritizing the current project while
including generic and foreign inspiration — and keep speculative memories or
links in editable proposals until the user approves `dream_apply`.

Feature details live in [docs/FEATURES.md](docs/FEATURES.md).
Remaining planned work lives in [ROADMAP.md](ROADMAP.md).

----

## Install From Source

For development inside this repo:

```powershell
npm install
npm run build
npm run check
```

---

## Configure Memory

For quick local testing, set the memory root with an environment variable:

```powershell
$env:AUGMENT_MEMORY_ROOT = "C:\Users\you\Dropbox\augment-memories"
```

Or create `~/.augment/config.json`:

```json
{
  "memoryRoot": "C:\\Users\\you\\Dropbox\\augment-memories",
  "stateDir": "C:\\Users\\you\\.augment\\state"
}
```

Defaults:

- Memory root: `~/.augment/memories`
- State directory: `~/.augment/state`

Also honored: `AUGMENT_STATE_DIR` (state directory), `AUGMENT_DAEMON_PORT`
(fixed daemon port; the default is dynamic), and `AUGMENT_GIT_AUTOCOMMIT` (set
`0` to disable auto-committing memory writes when the memory root is a git repo;
on by default). Full resolution order and defaults:
[docs/FEATURES.md](docs/FEATURES.md#configuration).

## Run Locally

Show all commands and options:

```powershell
node .\dist\bin\augment.js help
```

From the published package: `npx -y @fingerskier/augment help`.

Run diagnostics:

```powershell
node .\dist\bin\augment.js status
```

Start the daemon manually:

```powershell
node .\dist\bin\augment-daemon.js
```

Normally you do not need to start the daemon yourself. `augment-mcp` starts or
connects to the shared daemon automatically.

Restart after changing `memoryRoot` (or other config the daemon reads only at
startup):

```powershell
npx -y @fingerskier/augment restart
```

The dashboard also has a **Restart** button (with a confirm dialog).

Run the MCP server manually:

```powershell
node .\dist\bin\augment-mcp.js
```

It will appear idle in a terminal because it speaks MCP over stdio.

Do not use `npx @fingerskier/augment` from inside this repository. npm resolves
the current package first, but a package's own bins are not linked into its local
`node_modules/.bin`, so Windows reports `augment` as not recognized. Use the
compiled `node .\dist\bin\...` commands above while working in this repo.

From another directory, the published package works:

```powershell
npx @fingerskier/augment
npm exec --yes --package @fingerskier/augment -- augment status
```

## Local MCP Config

Use the compiled local MCP bin while dogfooding:

```json
{
  "mcpServers": {
    "augment": {
      "command": "node",
      "args": ["C:\\dev\\fingerskier\\agent\\augment\\dist\\bin\\augment-mcp.js"],
      "env": {
        "AUGMENT_MEMORY_ROOT": "C:\\Users\\you\\Dropbox\\augment-memories"
      }
    }
  }
}
```

Installed hosts use the same shape against the provisioned runtime under
`~/.augment/npm-exec` (after `augment install` warms that prefix):

```json
{
  "mcpServers": {
    "augment": {
      "command": "node",
      "args": [
        "C:/Users/you/.augment/npm-exec/node_modules/@fingerskier/augment/dist/bin/augment-mcp.js"
      ],
      "env": {
        "AUGMENT_MEMORY_ROOT": "C:\\Users\\you\\Dropbox\\augment-memories"
      }
    }
  }
}
```

Dogfooding instructions:

- Codex: [integrations/codex/SKILL.md](integrations/codex/SKILL.md)
- Claude: [integrations/claude/CLAUDE.md](integrations/claude/CLAUDE.md)
- Pi: [augment-context](integrations/pi/skills/augment-context/SKILL.md),
  [augment-decoction](integrations/pi/skills/augment-decoction/SKILL.md),
  [augment-dream](integrations/pi/skills/augment-dream/SKILL.md), and
  [augment-generic](integrations/pi/skills/augment-generic/SKILL.md)

## Pi Package

Augment ships as a first-class Pi package. Configure the shared memory root
first (for example with `AUGMENT_MEMORY_ROOT` or `~/.augment/config.json`; see
[Configure Memory](#configure-memory)), then install one of these ways.

Install globally for your Pi user settings (`~/.pi/agent/settings.json`):

```powershell
pi install npm:@fingerskier/augment
```

Install for just the current repository (`.pi/settings.json`, useful when the
team should share the package after trusting the project):

```powershell
pi install -l npm:@fingerskier/augment
```

Try it for one Pi run without changing settings:

```powershell
pi -e npm:@fingerskier/augment
```

While developing from this checkout, build first and load the local package path:

```powershell
npm run build
pi -e .
```

After installing, restart Pi or run `/reload`. The package manifest loads
`dist/pi/extension.js` and the Pi-specific `augment-context`,
`augment-decoction`, `augment-dream`, and `augment-generic` skills. The
extension keeps Claude/Codex behavior unchanged, does **not** run
`augment install`, and adds namespaced Pi tools so it does not shadow built-ins
like `read`:

- `augment_init_project`, `augment_list_projects`
- `augment_search`, `augment_project_context`, `augment_read_memory`
- `augment_upsert`, `augment_link`, `augment_list_links`, `augment_unlink`
- `augment_decoction_glean`, `augment_decoction_cleanup`
- `augment_sleep_candidates`, `augment_sleep_propose`, `augment_sleep_proposals`,
  `augment_sleep_apply`, `augment_sleep_reject`
- `augment_dream_propose`, `augment_dream_proposals`, `augment_dream_apply`,
  `augment_dream_reject`
- `augment_memory_insights`, `augment_memory_graph`

Pi slash commands:

- `/augment-context [query]` — inject Augment project context into the session.
- `/augment-persist [summary]` — ask the agent to persist completed work.
- `/augment-dashboard [--no-open]` — open or print the daemon dashboard URL.
- `/augment-sleep` — run the supervised sleep proposal workflow.
- `/augment-dream` — run the supervised dream proposal workflow.
- `/augment-generic [from: path|notes]` — store portable knowledge under `.generic/`.

A quick smoke test after install:

1. Run `/augment-context current project` and confirm an Augment context message appears.
2. Ask Pi to list available tools or inspect the prompt; `augment_read_memory`
   should exist and the built-in `read` tool should still be present.
3. Run `/augment-dashboard --no-open` and confirm it prints a localhost dashboard URL.

By default the Pi extension injects task-level memory during `before_agent_start`
and warns after non-trivial turns to persist durable work. Tune with
`AUGMENT_PI_AUTO_CONTEXT=inject|reminder|off`,
`AUGMENT_PI_AUTO_PERSIST=reminder|followup|off`,
`AUGMENT_PI_CONTEXT_LIMIT`, and `AUGMENT_PI_CONTEXT_MAX_CHARS`. The first recall
may take a moment while the daemon starts or the embedding model cache warms; if
Augment shows `augment: offline`, verify `AUGMENT_MEMORY_ROOT` /
`AUGMENT_STATE_DIR` and run `/augment-dashboard --no-open` to force a daemon
connection.

## Install Agent Integrations

Use Augment as an opencode plugin by adding it to opencode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["@fingerskier/augment", { "memoryRoot": "C:\\Users\\you\\Dropbox\\augment-memories" }]
  ]
}
```

The opencode plugin registers the local `augment` MCP server, injects relevant
memory into each user message, and adds Augment workflow guidance to the system
prompt. It also honors `AUGMENT_MEMORY_ROOT` / `~/.augment/config.json`; the
`memoryRoot` plugin option is just the config-file equivalent. Restart opencode
after changing config.

Install the Codex plugin and marketplace entry:

```powershell
npm exec --yes --package @fingerskier/augment -- augment install codex --scope user --memory-root "C:\Users\you\Dropbox\augment-memories"
```

Install the Claude plugin:

```powershell
npm exec --yes --package @fingerskier/augment -- augment install claude --scope repo --memory-root "C:\Users\you\Dropbox\augment-memories"
```

`install claude` does seven things:

- Scaffolds a real Claude Code plugin at `<root>/plugins/augment/`
  (`.claude-plugin/plugin.json`, auto-discovered context, sleep, decoction,
  dream, and generic skills, and a bundled `.mcp.json`).
- Writes `hooks/hooks.json` into the plugin — lifecycle hooks (SessionStart /
  UserPromptSubmit / PreToolUse / Stop) that auto-inject recalled memory and
  prompt the end-of-turn memory write-back.
- Provisions the hook runtime once (`npm install` into `~/.augment/npm-exec`) so
  hooks run via a direct `node` command instead of paying an npm bootstrap on
  every event.
- Adds a marketplace entry at `<root>/.claude-plugin/marketplace.json`.
- **Registers the MCP server directly** so it is active without the marketplace
  step: repo scope writes `<repo>/.mcp.json`; user scope merges into
  `~/.claude.json` (`mcpServers.augment`), preserving every other key.
- **Best-effort registers the packaged plugin via Claude's own CLI** — it runs
  `claude plugin marketplace add <root>` then
  `claude plugin install augment@<marketplace>` (user scope → `--scope user`;
  repo scope → `--scope project`). If `claude` is not on PATH it skips this and
  prints the manual commands instead. Pass `--no-plugin` to skip it entirely.
- Upserts the always-on memory-workflow guidance into `CLAUDE.md`.

`<root>` is the repo (`--scope repo`) or your home directory (`--scope user`).
The direct registration is enough on its own — restart Claude Code and the
`augment` tools appear. The plugin registration is what adds the packaged
Augment skills to `/plugin list`. If you skipped it (or `claude` was not found),
run the commands the installer prints, e.g.:

```text
/plugin marketplace add .
/plugin install augment@fingerskier-local
```

Both the direct registration and the plugin register a server named `augment`;
Claude's scope precedence resolves the duplicate to the higher-precedence one.

Install Grok Build:

```powershell
npm exec --yes --package @fingerskier/augment -- augment install grok --scope user --memory-root "C:\Users\you\Dropbox\augment-memories"
```

`install grok` writes Grok-native surfaces (no Claude-style marketplace plugin):

- Upserts `[mcp_servers.augment]` into `~/.grok/config.toml` (user) or
  `<repo>/.grok/config.toml` (repo), preserving unrelated TOML sections.
- Copies context / sleep / decoction / dream / generic skills into `.grok/skills/`.
- Writes lifecycle hooks to `.grok/hooks/augment.json` (same events as Claude/Codex;
  matchers use Claude tool names that Grok aliases to its own).
- Upserts a marked Augment block into `~/.grok/AGENTS.md` (user) or repo
  `AGENTS.md` (repo), including a TOML MCP example.

Restart Grok or press `r` in `/mcps` after install so MCP reloads.

Install Claude, Codex, and Grok together:

```powershell
npm exec --yes --package @fingerskier/augment -- augment install all --scope user --memory-root "C:\Users\you\Dropbox\augment-memories"
```

Preview writes before changing files:

```powershell
npm exec --yes --package @fingerskier/augment -- augment install codex --scope user --dry-run
```

The installer provisions `@fingerskier/augment` under `~/.augment/npm-exec` once
and points both MCP and lifecycle hooks at that copy with direct `node …/bin/…`
commands (no `npm exec` wrapper chain). If npm was unavailable at install time,
the installer prints the manual
`npm install --prefix <prefix> @fingerskier/augment` command; hooks stay silent
no-ops and MCP will not start until it is run. Re-run `augment install …` after
upgrading so hosts pick up a refreshed entry path, then restart agent sessions
so MCP children relaunch.

Run these package commands from outside this repository. When developing inside
this repo, use `node .\dist\bin\augment.js install ...` after `npm run build`.

## Dashboard

A local web UI for browsing and editing memories as a graph:

```powershell
npx -y @fingerskier/augment dashboard
```

This starts the shared daemon (if needed) and opens the dashboard in your browser.
It shows a graph of all projects; click a project to drill into its memory
subgraph (nodes colored by kind, edges labeled by link type). In Projects view,
the search box runs the existing global semantic search. Inside a project it
switches to debounced local fuzzy search over memory names, tags, and paths;
matches glow, their immediate graph context stays readable, and unrelated nodes
dim without disappearing.

The Fit, Relayout, and Refresh controls make graph movement explicit. Memory and
link mutations reconcile into the current graph while preserving its viewport,
selection, and settled positions where possible. Refresh is manual; the
dashboard does not poll or subscribe for remote changes. You can create, edit,
and delete memories and links against the daemon's localhost API.

- `augment dashboard` — start the daemon and open the UI.
- `augment dashboard --no-open` — just print the URL (honors `AUGMENT_DAEMON_PORT`).

The daemon binds `127.0.0.1` only and serves the dashboard and its API without
auth — anyone who needs to expose it beyond localhost should front it with their
own gateway. Developing inside this repo, use `node .\dist\bin\augment.js
dashboard` after `npm run build`.

### Dashboard snippets in chat (MCP Apps)

Hosts that support the [MCP Apps extension](https://github.com/modelcontextprotocol/ext-apps)
(SEP-1865: Claude.ai / Claude Desktop, ChatGPT, Goose, VS Code, …) can render
augment's dashboard snippets inline in the conversation. When a user asks for
memory insights, the agent can call:

- `memory_insights` — an interactive stats snippet: memories by kind, links by
  type, top tags, 12-week activity, and most-connected memories.
- `memory_graph` — an interactive Cytoscape view of the project's memory graph.

Both tools degrade to a plain-text summary in hosts without MCP Apps support
(the graph's node/edge payload is withheld there so it never burns model
context). Older MCP-UI hosts that render embedded `ui://` HTML blocks but never
negotiate the extension can opt in with `AUGMENT_MCP_UI_EMBED=1` in the MCP
server's environment.

## Package Check

Before publishing:

```powershell
npm run check
npm pack --dry-run
```

The package exposes these bins:

- `augment`
- `augment-daemon`
- `augment-mcp`
