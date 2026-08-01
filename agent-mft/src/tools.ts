/**
 * tools.ts — agent-callable memory tools (mem_query / mem_get / mem_add /
 * mem_supersede / mem_revoke).
 */
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MftRuntime } from "./runtime.ts";
import { parseQuery, type Kind } from "./query.ts";

const KINDS = [
  "decision",
  "fact",
  "preference",
  "task_state",
  "entity_rel",
  "commit",
  "note",
  "character",
  "world",
  "idea",
  "material",
  "plan",
  "event",
  "style",
] as const;

export function registerMemoryTools(pi: ExtensionAPI, runtime: () => MftRuntime | null): void {
  pi.registerTool({
    name: "mem_query",
    label: "Memory Query",
    description:
      "Search the memory index with an Everything-style filter expression. " +
      "Syntax: keywords, type:<kind>, entity:<name>, path:<a/b>, backend:<obs|chendpoc|manual>, " +
      "since:<1h|1d|2w|3m|1y>, imp:>0.7, status:active, #ADDR, --term to exclude. " +
      "Examples: 'type:decision entity:auth since:2w', 'sqlite', '#A1F3'.",
    promptSnippet: "Search the memory index with a filter expression",
    promptGuidelines: [
      "Use mem_query before repeating work or asking questions that were likely settled earlier — the index spans projects and sessions.",
      "Use mem_query with type:decision to check prior architecture decisions, and type:preference for user preferences.",
    ],
    parameters: Type.Object({
      expr: Type.String({ description: "Filter expression (Everything-style)" }),
      limit: Type.Optional(Type.Integer({ description: "Max results (default 20)" })),
    }),
    async execute(_toolCallId, params) {
      const rt = runtime();
      if (!rt) throw new Error("agent-mft runtime not available");
      let filter;
      try {
        filter = parseQuery(params.expr);
      } catch (e) {
        throw new Error(`invalid expression: ${e instanceof Error ? e.message : String(e)}`);
      }
      const records = rt.query(filter, params.limit ?? 20);
      if (records.length === 0) {
        return {
          content: [{ type: "text", text: "No matching memories." }],
          details: { count: 0 },
        };
      }
      const lines = records.map((r) => {
        const rel = r.ts ? ` ${relative(r.ts)}` : "";
        return `#${r.addr} [${r.kind}] ${r.filename}${rel} (imp ${r.importance.toFixed(1)}, ${r.backend})`;
      });
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { count: records.length, records: records.map((r) => r.addr) },
      };
    },
  });

  pi.registerTool({
    name: "mem_get",
    label: "Memory Get",
    description:
      "Expand a memory by address (e.g. #A1F3): returns metadata plus the original source content when available.",
    promptSnippet: "Expand a memory's full content by address",
    parameters: Type.Object({
      addr: Type.String({ description: "Memory address like A1F3 (with or without #)" }),
    }),
    async execute(_toolCallId, params) {
      const rt = runtime();
      if (!rt) throw new Error("agent-mft runtime not available");
      const addr = params.addr.replace(/^#/, "").toUpperCase();
      const record = rt.getByAddr(addr);
      if (!record) {
        return {
          content: [{ type: "text", text: `No memory found at #${addr}.` }],
          details: {},
        };
      }
      const body = await rt.expand(record);
      const text = [
        `#${record.addr} [${record.kind}] ${record.filename}`,
        `  backend: ${record.backend} | status: ${record.status} | imp: ${record.importance.toFixed(1)}`,
        record.entity ? `  entity: ${record.entity}` : "",
        record.ts ? `  ts: ${record.ts}` : "",
        record.src ? `  src: ${record.src}` : "",
        ``,
        body ?? "(no expandable content)",
      ]
        .filter((l) => l !== "")
        .join("\n");
      return { content: [{ type: "text", text }], details: { addr: record.addr } };
    },
  });

  pi.registerTool({
    name: "mem_add",
    label: "Memory Add",
    description:
      "Record a durable memory: a decision, fact, preference, task state, entity relation, commit or note. " +
      "Returns its deterministic address for later reference.",
    promptSnippet: "Record a durable memory (decision/fact/preference/…)",
    promptGuidelines: [
      "Use mem_add after a significant architecture decision, when the user states a preference, or when a task completes with reusable knowledge.",
      "Keep filename to one concise line; it is what future searches match against.",
      "Use mem_supersede when a newer decision replaces an older recorded one.",
    ],
    parameters: Type.Object({
      filename: Type.String({ description: "One-line concise description (searchable)" }),
      kind: StringEnum(KINDS as readonly string[]),
      entity: Type.Optional(Type.String({ description: "Primary entity (normalized)" })),
      entity2: Type.Optional(Type.String({ description: "Related entity" })),
      path: Type.Optional(Type.String({ description: "Hierarchical path like projA/arch" })),
      importance: Type.Optional(Type.Number({ description: "0..1 (default 0.6)" })),
      content: Type.Optional(Type.String({ description: "Optional full content snapshot" })),
    }),
    async execute(_toolCallId, params) {
      const rt = runtime();
      if (!rt) throw new Error("agent-mft runtime not available");
      const rec = rt.addManual({
        filename: params.filename,
        kind: params.kind as Kind,
        entity: params.entity,
        path: params.path,
        importance: params.importance,
        content: params.content,
      });
      return {
        content: [
          {
            type: "text",
            text: `Recorded as #${rec.addr} [${rec.kind}] ${rec.filename}${rec.entity ? ` (entity: ${rec.entity})` : ""}`,
          },
        ],
        details: { addr: rec.addr },
      };
    },
  });

  pi.registerTool({
    name: "mem_supersede",
    label: "Memory Supersede",
    description:
      "Mark an older memory as superseded by a newer one (both by address). The old record stays addressable but is filtered from default queries.",
    promptSnippet: "Mark an old memory as superseded by a newer one",
    parameters: Type.Object({
      old_addr: Type.String({ description: "Address of the superseded memory (e.g. A1F3)" }),
      new_addr: Type.String({ description: "Address of the replacing memory (e.g. B7C2)" }),
    }),
    async execute(_toolCallId, params) {
      const rt = runtime();
      if (!rt) throw new Error("agent-mft runtime not available");
      const ok = rt.supersede(
        params.old_addr.replace(/^#/, "").toUpperCase(),
        params.new_addr.replace(/^#/, "").toUpperCase(),
      );
      return {
        content: [
          {
            type: "text",
            text: ok
              ? `#${params.old_addr} superseded by #${params.new_addr}.`
              : `Failed: #${params.old_addr} not found.`,
          },
        ],
        details: { ok },
      };
    },
  });

  pi.registerTool({
    name: "mem_revoke",
    label: "Memory Revoke",
    description: "Revoke (delete) a memory by address. Use when a record is wrong or obsolete.",
    parameters: Type.Object({
      addr: Type.String({ description: "Address of the memory to revoke (e.g. A1F3)" }),
    }),
    async execute(_toolCallId, params) {
      const rt = runtime();
      if (!rt) throw new Error("agent-mft runtime not available");
      const ok = rt.revoke(params.addr.replace(/^#/, "").toUpperCase());
      return {
        content: [{ type: "text", text: ok ? `#${params.addr} revoked.` : `Failed: #${params.addr} not found.` }],
        details: { ok },
      };
    },
  });

  pi.registerTool({
    name: "mem_pin",
    label: "Memory Pin",
    description:
      "Pin a memory so it enters the resident set (stable prefix). Pinned memories stay present in the system prompt across sessions — free with DeepSeek prefix caching. Use for character sheets, world lore, key decisions, preferences.",
    promptSnippet: "Pin a memory into the resident set (always present, cached)",
    promptGuidelines: [
      "Use mem_pin for long-lived context the user relies on every session: character settings, world lore, style preferences, standing decisions.",
      "Prefer pinning over repeated mem_query when the same memory is needed every conversation.",
      "Avoid pinning volatile state (in-progress tasks); use mem_add instead.",
    ],
    parameters: Type.Object({
      addr: Type.String({ description: "Address of the memory to pin (e.g. A1F3)" }),
    }),
    async execute(_toolCallId, params) {
      const rt = runtime();
      if (!rt) throw new Error("agent-mft runtime not available");
      const ok = rt.pin(params.addr.replace(/^#/, "").toUpperCase());
      return {
        content: [
          {
            type: "text",
            text: ok
              ? `#${params.addr} pinned — now resident (always present, cached).`
              : `Failed: #${params.addr} not found.`,
          },
        ],
        details: { ok, pinned: true },
      };
    },
  });

  pi.registerTool({
    name: "mem_unpin",
    label: "Memory Unpin",
    description: "Remove a memory from the resident set by address.",
    parameters: Type.Object({
      addr: Type.String({ description: "Address of the memory to unpin (e.g. A1F3)" }),
    }),
    async execute(_toolCallId, params) {
      const rt = runtime();
      if (!rt) throw new Error("agent-mft runtime not available");
      const ok = rt.unpin(params.addr.replace(/^#/, "").toUpperCase());
      return {
        content: [{ type: "text", text: ok ? `#${params.addr} unpinned.` : `Failed: #${params.addr} not found.` }],
        details: { ok, pinned: false },
      };
    },
  });
}

function relative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Math.max(0, Date.now() - t);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
