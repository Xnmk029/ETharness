/**
 * runtime.ts — MftRuntime: dual-mirror lifecycle + merged querying.
 *
 *   global mirror : ~/.pi/agent/agent-mft/mirror.sqlite  (cross-project)
 *   project mirror: <cwd>/.pi/agent-mft/mirror.sqlite    (project-scoped)
 *
 * Project records are mirrored into the global mirror after compaction/sync.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Mirror } from "./mirror.ts";
import type { Filter, MemoryRecord } from "./query.ts";
import { query as applyQuery, score } from "./query.ts";
import { globalMirrorPath, projectMirrorPath } from "./utils/paths.ts";
import type { BackendAdapter } from "./adapters/types.ts";

export interface MftConfig {
  inject: "auto" | "off"; // v1: auto (rule-based evaluate) or off
  injectLimit: number; // default 10
  injectMinImportance: number; // default 0.4
  autoRebuildOnEmpty: boolean; // default true
  residentThreshold: number; // importance threshold for resident set (default 0.6)
  residentMaxEntries: number; // cap for resident block (default 24)
  // cache telemetry pricing ($ per 1M tokens) — DeepSeek V4-Flash defaults
  cacheMissPrice: number; // default 0.14
  cacheHitPrice: number; // default 0.0028
}

export const DEFAULT_CONFIG: MftConfig = {
  inject: "auto",
  injectLimit: 10,
  injectMinImportance: 0.4,
  autoRebuildOnEmpty: true,
  residentThreshold: 0.6,
  residentMaxEntries: 24,
  cacheMissPrice: 0.14,
  cacheHitPrice: 0.0028,
};

export class MftRuntime {
  readonly globalMirror: Mirror;
  readonly projectMirror: Mirror | null;
  readonly cwd: string;
  readonly config: MftConfig;
  adapters: BackendAdapter[] = [];
  isFirstTurn = true;

  private constructor(
    globalMirror: Mirror,
    projectMirror: Mirror | null,
    cwd: string,
    config: MftConfig,
  ) {
    this.globalMirror = globalMirror;
    this.projectMirror = projectMirror;
    this.cwd = cwd;
    this.config = config;
  }

  static open(cwd: string, config: Partial<MftConfig> = {}): MftRuntime {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const gp = globalMirrorPath();
    mkdirSync(dirname(gp), { recursive: true });
    const globalMirror = new Mirror(gp);
    let projectMirror: Mirror | null = null;
    try {
      const pp = projectMirrorPath(cwd);
      mkdirSync(dirname(pp), { recursive: true });
      projectMirror = new Mirror(pp);
    } catch {
      projectMirror = null; // project mirror optional
    }
    return new MftRuntime(globalMirror, projectMirror, cwd, cfg);
  }

  close(): void {
    this.globalMirror.close();
    this.projectMirror?.close();
  }

  /** Merged record set from project (preferred) + global, deduped by backend key. */
  allRecords(): MemoryRecord[] {
    const byKey = new Map<string, MemoryRecord>();
    const projectRecs = this.projectMirror?.listAll() ?? [];
    for (const r of projectRecs) byKey.set(`${r.backend}:${r.backend_key}`, r);
    for (const r of this.globalMirror.listAll()) {
      const key = `${r.backend}:${r.backend_key}`;
      if (!byKey.has(key)) byKey.set(key, r);
    }
    return [...byKey.values()];
  }

  query(filter: Filter, limit = 50): MemoryRecord[] {
    return applyQuery(this.allRecords(), filter, limit);
  }

  /** Resolve a record across both mirrors. */
  getByAddr(addr: string): MemoryRecord | null {
    return (
      this.projectMirror?.getByAddr(addr) ??
      this.globalMirror.getByAddr(addr) ??
      null
    );
  }

  /** Expand full content through the owning backend adapter. */
  async expand(record: MemoryRecord): Promise<string | null> {
    const adapter = this.adapters.find((a) => a.id === record.backend);
    if (!adapter) return (record.meta?.content as string) ?? record.filename;
    try {
      return await adapter.expand(record);
    } catch {
      return record.filename;
    }
  }

  /** Add a manual memory (truth lives in the mirror itself, backend "manual"). */
  addManual(input: {
    filename: string;
    kind: MemoryRecord["kind"];
    entity?: string;
    path?: string;
    importance?: number;
    content?: string;
  }): MemoryRecord {
    const mirror = this.projectMirror ?? this.globalMirror;
    const rec: MemoryRecord = {
      addr: mirror.nextAddr(),
      backend_key: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      filename: input.filename,
      kind: input.kind,
      entity: input.entity,
      path: input.path,
      project: this.cwd,
      ts: new Date().toISOString(),
      importance: input.importance ?? 0.6,
      status: "active",
      src: `manual:${input.filename}`,
      backend: "manual",
      meta: input.content ? { content: input.content } : undefined,
    };
    mirror.upsert(rec);
    this.globalMirror.upsert({ ...rec, project: this.cwd }); // mirror into global too
    return rec;
  }

  supersede(oldAddr: string, newAddr: string): boolean {
    const mirror = this.projectMirror ?? this.globalMirror;
    const ok = mirror.markSuperseded(oldAddr, newAddr);
    if (ok) this.globalMirror.markSuperseded(oldAddr, newAddr);
    return ok;
  }

  revoke(addr: string): boolean {
    const mirror = this.projectMirror ?? this.globalMirror;
    const ok = mirror.markRevoked(addr);
    if (ok) this.globalMirror.markRevoked(addr);
    return ok;
  }

  // ── resident memory (pinned) ────────────────────────────────────────────

  /** Pinned or high-importance active records, ordered stably by addr. */
  residentRecords(): MemoryRecord[] {
    const records = this.allRecords().filter(
      (r) =>
        r.status === "active" &&
        (r.pinned === true || r.importance >= this.config.residentThreshold),
    );
    // stable order: pinned first (by pinned_at), then by addr — never by score
    const pinned = records.filter((r) => r.pinned).sort((a, b) => (a.pinned_at ?? "").localeCompare(b.pinned_at ?? ""));
    const auto = records.filter((r) => !r.pinned).sort((a, b) => a.addr.localeCompare(b.addr));
    return [...pinned, ...auto].slice(0, this.config.residentMaxEntries);
  }

  pin(addr: string): boolean {
    const mirror = this.projectMirror ?? this.globalMirror;
    const ok = mirror.setPinned(addr, true);
    if (ok) this.globalMirror.setPinned(addr, true);
    return ok;
  }

  unpin(addr: string): boolean {
    const mirror = this.projectMirror ?? this.globalMirror;
    const ok = mirror.setPinned(addr, false);
    if (ok) this.globalMirror.setPinned(addr, false);
    return ok;
  }

  /** Render the stable resident block (injected into system prompt tail). */
  renderResidentBlock(): string {
    const records = this.residentRecords();
    if (records.length === 0) return "";
    const lines = records.map((r) => {
      const parts = [`#${r.addr}`, `[${r.kind}]`, r.filename];
      if (r.entity) parts.push(`(entity: ${r.entity})`);
      if (r.pinned) parts.push("(pinned)");
      return `- ${parts.join(" ")}`;
    });
    return [
      "## Resident Memory（常驻记忆，稳定前缀）",
      "以下记忆长期在场，跨会话免费可用。需要细节时用 mem_get <addr> 展开原文。",
      "",
      ...lines,
    ].join("\n");
  }

  // ── cache telemetry ─────────────────────────────────────────────────────

  recordCacheUsage(input: { sessionId?: string; cacheRead: number; cacheWrite: number; inputTokens: number }): void {
    this.globalMirror.recordTelemetry(input);
    this.projectMirror?.recordTelemetry(input);
  }

  cacheStats(): {
    requests: number;
    totalInput: number;
    totalCacheRead: number;
    hitRate: number;
    estimatedSavedUsd: number;
  } {
    const s = this.globalMirror.telemetrySummary();
    const savedPerM = this.config.cacheMissPrice - this.config.cacheHitPrice;
    return {
      ...s,
      estimatedSavedUsd: (s.totalCacheRead / 1_000_000) * savedPerM,
    };
  }

  stats(): Record<string, unknown> {
    return {
      project: this.projectMirror?.count() ?? 0,
      global: this.globalMirror.count(),
      adapters: this.adapters.map((a) => a.id),
      inject: this.config.inject,
    };
  }

  /** Rule-based injection evaluation for the first turn. */
  evaluateInjection(prompt: string): MemoryRecord[] {
    if (this.config.inject === "off") return [];
    const now = Date.now();
    const cutoff = now - 90 * 86_400_000; // 90 days
    const candidates = this.query({
      keywords: [],
      excludes: [],
      raw: "",
    }).filter(
      (r) =>
        r.status === "active" &&
        r.importance >= this.config.injectMinImportance &&
        (r.ts === undefined || Date.parse(r.ts) >= cutoff),
    );
    if (candidates.length === 0) return [];

    // keyword hit: does the prompt reference something in memory?
    const promptLower = prompt.toLowerCase();
    const kw = promptLower.split(/\s+/).filter((w) => w.length >= 2);
    const hit =
      candidates.some((r) => {
        const f = r.filename.toLowerCase();
        return kw.some((w) => f.includes(w)) || r.entity?.toLowerCase().includes(promptLower) === true;
      }) || candidates.some((r) => r.importance >= 0.7);

    return hit ? candidates.slice(0, this.config.injectLimit) : [];
  }

  /** Render the memory map block injected into the first turn. */
  renderMemoryMap(records: MemoryRecord[], now = Date.now()): string {
    const lines = records.map((r) => {
      const rel = r.ts ? relativeTime(r.ts, now) : "";
      const parts = [
        `#${r.addr}`,
        `[${r.kind}]`,
        r.filename,
        r.entity ? `(entity: ${r.entity})` : "",
        r.path ? `(path: ${r.path})` : "",
        rel ? `(${rel})` : "",
        `(imp ${r.importance.toFixed(1)})`,
      ].filter(Boolean);
      return `- ${parts.join(" ")}`;
    });
    return [
      "## Memory Map（来自 agent-mft 记忆内核）",
      "以下为当前项目相关记忆。需要细节时用 mem_get <addr> 展开原文。",
      "",
      ...lines,
    ].join("\n");
  }
}

export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Math.max(0, now - t);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

/** Score helper re-export for tool output ordering. */
export function rank(records: MemoryRecord[]): MemoryRecord[] {
  return [...records].sort((a, b) => score(b) - score(a));
}

export function bindContext(ctx: ExtensionContext): { cwd: string } {
  return { cwd: ctx.cwd };
}
