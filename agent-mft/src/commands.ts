/**
 * commands.ts — user-facing commands:
 *   /mft <expr>            browse memory (filter/select/expand)
 *   /mft:add <text>        manually record a memory
 *   /mft:inject            manually inject the memory map into the next turn
 *   /mft:rebuild           rebuild the mirror projection from backends
 *   /mft:stats             show mirror stats
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { MftRuntime } from "./runtime.ts";
import { parseQuery, type MemoryRecord, type Kind } from "./query.ts";
import { rebuild } from "./rebuild.ts";

const SUGGESTIONS = [
  "type:decision",
  "type:fact",
  "type:preference",
  "type:task_state",
  "type:entity_rel",
  "type:commit",
  "type:note",
  "entity:",
  "path:",
  "backend:chendpoc",
  "backend:obs",
  "backend:manual",
  "since:1h",
  "since:1d",
  "since:2w",
  "since:3m",
  "since:1y",
  "imp:>0.5",
  "imp:>0.7",
  "status:active",
  "status:superseded",
  "status:revoked",
];

export function registerCommands(
  pi: ExtensionAPI,
  runtime: () => MftRuntime | null,
  runRebuild: () => Promise<unknown>,
  manualInject: (text: string) => Promise<void>,
): void {
  pi.registerCommand("mft", {
    description: "Browse memory (Everything-style filter expression)",
    getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
      const items = SUGGESTIONS.map((s) => ({ value: s, label: s }));
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const rt = runtime();
      if (!rt) {
        ctx.ui.notify("agent-mft runtime not available", "error");
        return;
      }
      const expr = args.trim() || "";
      let filter;
      try {
        filter = parseQuery(expr);
      } catch (e) {
        ctx.ui.notify(`Bad expression: ${e instanceof Error ? e.message : String(e)}`, "error");
        return;
      }
      const records = rt.query(filter, 50);
      if (records.length === 0) {
        ctx.ui.notify(`No memories match: ${expr || "(all)"}`, "info");
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify(`${formatList(records, expr)}`, "info");
        return;
      }
      const choice = await ctx.ui.select(
        `${records.length} memories — pick one to expand:`,
        records.map((r) => ({
          value: r.addr,
          label: `#${r.addr} [${r.kind}] ${r.filename}`,
        })),
        { placeholder: expr || "all memories" },
      );
      if (!choice) return;
      const record = rt.getByAddr(choice);
      if (!record) return;
      const body = await rt.expand(record);
      ctx.ui.notify(
        [`#${record.addr} [${record.kind}] ${record.filename}`, body ?? "(no content)"].join("\n"),
        "info",
      );
    },
  });

  pi.registerCommand("mft:add", {
    description: "Record a memory: /mft:add <filename> [kind=note] [entity=x]",
    handler: async (args, ctx) => {
      const rt = runtime();
      if (!rt) {
        ctx.ui.notify("agent-mft runtime not available", "error");
        return;
      }
      const text = args.trim();
      if (!text) {
        ctx.ui.notify("Usage: /mft:add <描述> [kind=decision] [entity=xxx] [imp=0.8]", "info");
        return;
      }
      let kind: Kind = "note";
      let entity: string | undefined;
      let importance: number | undefined;
      let filename = text;
      const kindMatch = /kind=(\w+)/.exec(text);
      const entityMatch = /entity=([\w-]+)/.exec(text);
      const impMatch = /imp=(\d(?:\.\d+)?)/.exec(text);
      if (kindMatch) {
        const k = kindMatch[1] as Kind;
        if (["decision", "fact", "preference", "task_state", "entity_rel", "commit", "note"].includes(k)) {
          kind = k;
        }
        filename = filename.replace(kindMatch[0], "").trim();
      }
      if (entityMatch) {
        entity = entityMatch[1];
        filename = filename.replace(entityMatch[0], "").trim();
      }
      if (impMatch) {
        importance = Number.parseFloat(impMatch[1]);
        filename = filename.replace(impMatch[0], "").trim();
      }
      const rec = rt.addManual({ filename, kind, entity, importance });
      ctx.ui.notify(`Recorded #${rec.addr} [${rec.kind}] ${rec.filename}`, "info");
    },
  });

  pi.registerCommand("mft:inject", {
    description: "Manually inject the memory map into the next turn",
    handler: async (_args, ctx) => {
      await manualInject(ctx.cwd);
      ctx.ui.notify("Memory map injected into the next turn.", "info");
    },
  });

  pi.registerCommand("mft:rebuild", {
    description: "Rebuild the mirror projection from memory backends",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("agent-mft", "rebuilding…");
      try {
        const result = await runRebuild();
        ctx.ui.notify(JSON.stringify(result), "info");
      } finally {
        ctx.ui.setStatus("agent-mft", undefined);
      }
    },
  });

  pi.registerCommand("mft:stats", {
    description: "Show mirror statistics",
    handler: async (_args, ctx) => {
      const rt = runtime();
      if (!rt) {
        ctx.ui.notify("agent-mft runtime not available", "error");
        return;
      }
      const s = rt.stats();
      const all = rt.allRecords();
      const byKind: Record<string, number> = {};
      for (const r of all) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
      ctx.ui.notify(
        [
          `project: ${s.project} | global: ${s.global} | adapters: ${(s.adapters as string[]).join(", ") || "none"}`,
          `kinds: ${Object.entries(byKind)
            .map(([k, n]) => `${k}=${n}`)
            .join(", ")}`,
          `inject: ${String(s.inject)}`,
        ].join("\n"),
        "info",
      );
    },
  });
}

function formatList(records: MemoryRecord[], _expr: string): string {
  return records.map((r) => `#${r.addr} [${r.kind}] ${r.filename} (${r.backend})`).join("\n");
}

export { rebuild };
