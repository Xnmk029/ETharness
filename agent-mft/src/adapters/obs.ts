/**
 * adapters/obs.ts — adapter for pi-observational-memory session ledger.
 *
 * Scans pi session JSONL files for custom entries:
 *   - om.observations.recorded → observations (events, relevance-ranked)
 *   - om.reflections.recorded   → reflections (durable facts)
 * Each becomes a MemoryRecord. Expansion replays source entries from the
 * session file (equivalent to obs's own recall tool).
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryRecord } from "../query.ts";
import { sessionsDir } from "../utils/paths.ts";
import type { BackendAdapter } from "./types.ts";

const OBS_CUSTOM_TYPE = "om.observations.recorded";
const REFL_CUSTOM_TYPE = "om.reflections.recorded";

const RELEVANCE_IMPORTANCE: Record<string, number> = {
  low: 0.3,
  medium: 0.5,
  high: 0.7,
  critical: 0.9,
};

interface ObsEntry {
  id: string;
  content: string;
  timestamp: string;
  relevance?: string;
  sourceEntryIds?: string[];
}

export class ObsAdapter implements BackendAdapter {
  readonly id = "obs";
  readonly label = "pi-observational-memory (session ledger)";
  private readonly root: string;

  constructor(root: string = sessionsDir()) {
    this.root = root;
  }

  /** Enumerate session files (jsonl, excluding .edit-backup). */
  private async listSessionFiles(): Promise<string[]> {
    const out: string[] = [];
    let dirs: string[] = [];
    try {
      dirs = await readdir(this.root);
    } catch {
      return out; // no sessions yet
    }
    for (const d of dirs) {
      const dir = join(this.root, d);
      try {
        const files = await readdir(dir);
        for (const f of files) {
          if (f.endsWith(".jsonl") && !f.includes(".edit-backup")) out.push(join(dir, f));
        }
      } catch {
        // not a dir
      }
    }
    return out;
  }

  private async readEntries(file: string): Promise<
    { customType: string; entryId: string; data: Record<string, unknown>; ts: string; project: string }[]
  > {
    const project = this.projectFromFile(file);
    const out: {
      customType: string;
      entryId: string;
      data: Record<string, unknown>;
      ts: string;
      project: string;
    }[] = [];
    try {
      const content = await readFile(file, "utf8");
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          if (e?.type === "custom") {
            const ct = e.customType as string;
            if (ct === OBS_CUSTOM_TYPE || ct === REFL_CUSTOM_TYPE) {
              out.push({
                customType: ct,
                entryId: String(e.id ?? ""),
                data: (e.data ?? {}) as Record<string, unknown>,
                ts: String(e.timestamp ?? ""),
                project,
              });
            }
          }
        } catch {
          // skip malformed line
        }
      }
    } catch {
      // skip unreadable file
    }
    return out;
  }

  /** Derive a coarse project id from the session directory name (--C--Users--…--). */
  private projectFromFile(file: string): string {
    const parts = file.split(/[\\/]/);
    const dir = parts[parts.length - 2] ?? "";
    return dir.replace(/^--|--$/g, "");
  }

  async listRecords(): Promise<MemoryRecord[]> {
    const records: MemoryRecord[] = [];
    const files = await this.listSessionFiles();
    for (const file of files) {
      for (const entry of await this.readEntries(file)) {
        if (entry.customType === OBS_CUSTOM_TYPE) {
          const list = (entry.data.observations ?? []) as ObsEntry[];
          for (const o of list) {
            records.push(this.toRecord(file, entry, o, "note"));
          }
        } else if (entry.customType === REFL_CUSTOM_TYPE) {
          const list = (entry.data.reflections ?? []) as { id: string; content: string; tokenCount?: number }[];
          for (const r of list) {
            records.push(
              this.toRecord(
                file,
                entry,
                { id: r.id, content: r.content, timestamp: entry.ts },
                "fact",
              ),
            );
          }
        }
      }
    }
    return records;
  }

  private toRecord(
    file: string,
    entry: { entryId: string; project: string },
    o: ObsEntry,
    kind: MemoryRecord["kind"],
  ): MemoryRecord {
    return {
      addr: "",
      backend_key: `${entry.entryId}:${o.id}`,
      filename: o.content.slice(0, 120),
      kind,
      ts: o.timestamp || undefined,
      importance: RELEVANCE_IMPORTANCE[o.relevance ?? ""] ?? 0.5,
      status: "active",
      src: `${file}#${entry.entryId}`,
      backend: "obs",
      project: entry.project || undefined,
      meta: { observationId: o.id, sourceEntryIds: o.sourceEntryIds ?? [] },
    };
  }

  /** Replay the source entries referenced by an observation (like obs recall). */
  async expand(record: MemoryRecord): Promise<string | null> {
    const src = record.src;
    const hashIdx = src.lastIndexOf("#");
    if (hashIdx < 0) return null;
    const file = src.slice(0, hashIdx);
    const entryId = src.slice(hashIdx + 1);
    const sourceEntryIds = (record.meta?.sourceEntryIds ?? []) as string[];

    try {
      const content = await readFile(file, "utf8");
      const lines = content.split("\n");
      const excerpts: string[] = [];
      const wanted = new Set(sourceEntryIds.length ? sourceEntryIds : [entryId]);
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const e = JSON.parse(line);
          const id = String(e?.id ?? "");
          if (!wanted.has(id)) continue;
          if (e?.type === "message") {
            const m = e.message;
            const text = Array.isArray(m?.content)
              ? m.content
                  .map((c: { type?: string; text?: string; thinking?: string }) =>
                    c?.type === "text" ? c.text : c?.type === "thinking" ? `[thinking] ${c.thinking}` : "",
                  )
                  .filter(Boolean)
                  .join("\n")
              : typeof m?.content === "string"
                ? m.content
                : "";
            if (text) excerpts.push(`[${m?.role ?? "?"}] ${text.slice(0, 2000)}`);
          } else if (e?.type === "custom") {
            excerpts.push(`[custom ${e.customType}] ${JSON.stringify(e.data ?? {}).slice(0, 1000)}`);
          }
        } catch {
          // skip
        }
      }
      return excerpts.length ? excerpts.join("\n---\n") : `(source not found in ${file})`;
    } catch {
      return null;
    }
  }
}

export default ObsAdapter;
