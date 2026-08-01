/**
 * mirror.ts — cross-session rebuildable projection (SQLite, node:sqlite).
 *
 * The mirror is a *projection*: backends (chendpoc MEMORY.md, obs session
 * ledger) are the source of truth. The mirror can be dropped and rebuilt at
 * any time via rebuild.ts. It exists for fast unified addressing.
 *
 * Storage layout: single table `mirror` + `addr_seq` (address counter).
 */

import { DatabaseSync } from "node:sqlite";
import { encodeAddr } from "./addr.ts";
import type { Filter, MemoryRecord } from "./query.ts";
import { query as applyQuery } from "./query.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mirror (
  addr       TEXT PRIMARY KEY,
  backend    TEXT NOT NULL,
  backend_key TEXT NOT NULL,
  filename   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  entity     TEXT,
  entity2    TEXT,
  path       TEXT,
  project    TEXT,
  ts         TEXT,
  importance REAL NOT NULL DEFAULT 0.5,
  status     TEXT NOT NULL DEFAULT 'active',
  supersedes TEXT,
  src        TEXT,
  meta       TEXT,
  pinned     INTEGER NOT NULL DEFAULT 0,
  pinned_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_mirror_kind ON mirror(kind);
CREATE INDEX IF NOT EXISTS idx_mirror_entity ON mirror(entity);
CREATE INDEX IF NOT EXISTS idx_mirror_project ON mirror(project);
CREATE INDEX IF NOT EXISTS idx_mirror_backend ON mirror(backend);
CREATE INDEX IF NOT EXISTS idx_mirror_status ON mirror(status);
CREATE TABLE IF NOT EXISTS addr_seq (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  seq INTEGER NOT NULL
);
INSERT OR IGNORE INTO addr_seq (id, seq) VALUES (1, 0);
CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  session_id TEXT,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0
);
`;

/** Add columns introduced after v1 to pre-existing databases. */
function migrate(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(mirror)").all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("pinned")) {
    db.exec("ALTER TABLE mirror ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
  }
  if (!names.has("pinned_at")) {
    db.exec("ALTER TABLE mirror ADD COLUMN pinned_at TEXT");
  }
}

interface Row {
  addr: string;
  backend: string;
  backend_key: string;
  filename: string;
  kind: string;
  entity: string | null;
  entity2: string | null;
  path: string | null;
  project: string | null;
  ts: string | null;
  importance: number;
  status: string;
  supersedes: string | null;
  src: string | null;
  meta: string | null;
  pinned: number;
  pinned_at: string | null;
}

function rowToRecord(r: Row): MemoryRecord {
  return {
    addr: r.addr,
    backend: r.backend as MemoryRecord["backend"],
    backend_key: r.backend_key,
    filename: r.filename,
    kind: r.kind as MemoryRecord["kind"],
    entity: r.entity ?? undefined,
    entity2: r.entity2 ?? undefined,
    path: r.path ?? undefined,
    project: r.project ?? undefined,
    ts: r.ts ?? undefined,
    importance: r.importance,
    status: r.status as MemoryRecord["status"],
    supersedes: r.supersedes ?? undefined,
    src: r.src ?? "",
    meta: r.meta ? JSON.parse(r.meta) : undefined,
    pinned: r.pinned === 1,
    pinned_at: r.pinned_at ?? undefined,
  };
}

function recordToRow(r: MemoryRecord): Row {
  return {
    addr: r.addr,
    backend: r.backend,
    backend_key: r.backend_key ?? r.src,
    filename: r.filename,
    kind: r.kind,
    entity: r.entity ?? null,
    entity2: r.entity2 ?? null,
    path: r.path ?? null,
    project: r.project ?? null,
    ts: r.ts ?? null,
    importance: r.importance,
    status: r.status,
    supersedes: r.supersedes ?? null,
    src: r.src ?? "",
    meta: r.meta ? JSON.stringify(r.meta) : null,
    pinned: r.pinned ? 1 : 0,
    pinned_at: r.pinned_at ?? null,
  };
}

export class Mirror {
  private db: DatabaseSync;
  readonly path: string;

  constructor(dbPath: string) {
    this.path = dbPath;
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA busy_timeout = 3000;");
    this.db.exec(SCHEMA);
    migrate(this.db);
  }

  /** Allocate the next deterministic address. */
  nextAddr(): string {
    const row = this.db.prepare("SELECT seq FROM addr_seq WHERE id = 1").get() as
      | { seq: number }
      | undefined;
    const seq = (row?.seq ?? 0) + 1;
    this.db.prepare("UPDATE addr_seq SET seq = ? WHERE id = 1").run(seq);
    return encodeAddr(seq);
  }

  /** Peek the current sequence without consuming. */
  peekSeq(): number {
    const row = this.db.prepare("SELECT seq FROM addr_seq WHERE id = 1").get() as
      | { seq: number }
      | undefined;
    return row?.seq ?? 0;
  }

  upsert(record: MemoryRecord): void {
    const r = recordToRow(record);
    this.db
      .prepare(
        `INSERT INTO mirror (addr, backend, backend_key, filename, kind, entity, entity2, path, project, ts, importance, status, supersedes, src, meta, pinned, pinned_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(addr) DO UPDATE SET
           backend=excluded.backend, backend_key=excluded.backend_key, filename=excluded.filename,
           kind=excluded.kind, entity=excluded.entity, entity2=excluded.entity2, path=excluded.path,
           project=excluded.project, ts=excluded.ts, importance=excluded.importance,
           status=excluded.status, supersedes=excluded.supersedes, src=excluded.src, meta=excluded.meta,
           pinned=excluded.pinned, pinned_at=excluded.pinned_at`,
      )
      .run(
        r.addr,
        r.backend,
        r.backend_key,
        r.filename,
        r.kind,
        r.entity,
        r.entity2,
        r.path,
        r.project,
        r.ts,
        r.importance,
        r.status,
        r.supersedes,
        r.src,
        r.meta,
        r.pinned,
        r.pinned_at,
      );
  }

  bulkUpsert(records: MemoryRecord[]): number {
    const upsert = this.db.prepare(
      `INSERT INTO mirror (addr, backend, backend_key, filename, kind, entity, entity2, path, project, ts, importance, status, supersedes, src, meta, pinned, pinned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(addr) DO UPDATE SET
         backend=excluded.backend, backend_key=excluded.backend_key, filename=excluded.filename,
         kind=excluded.kind, entity=excluded.entity, entity2=excluded.entity2, path=excluded.path,
         project=excluded.project, ts=excluded.ts, importance=excluded.importance,
         status=excluded.status, supersedes=excluded.supersedes, src=excluded.src, meta=excluded.meta,
         pinned=excluded.pinned, pinned_at=excluded.pinned_at`,
    );
    this.db.exec("BEGIN");
    try {
      for (const r of records) {
        const row = recordToRow(r);
        upsert.run(
          row.addr,
          row.backend,
          row.backend_key,
          row.filename,
          row.kind,
          row.entity,
          row.entity2,
          row.path,
          row.project,
          row.ts,
          row.importance,
          row.status,
          row.supersedes,
          row.src,
          row.meta,
          row.pinned,
          row.pinned_at,
        );
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return records.length;
  }

  getByAddr(addr: string): MemoryRecord | null {
    const row = this.db.prepare("SELECT * FROM mirror WHERE addr = ?").get(addr.toUpperCase()) as
      | Row
      | undefined;
    return row ? rowToRecord(row) : null;
  }

  getByBackendKey(backend: string, backendKey: string): MemoryRecord | null {
    const row = this.db
      .prepare("SELECT * FROM mirror WHERE backend = ? AND backend_key = ?")
      .get(backend, backendKey) as Row | undefined;
    return row ? rowToRecord(row) : null;
  }

  listAll(): MemoryRecord[] {
    const rows = this.db.prepare("SELECT * FROM mirror").all() as Row[];
    return rows.map(rowToRecord);
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM mirror").get() as { n: number };
    return row.n;
  }

  /** Filter + score + limit over the mirror (in-memory match; fine for <100k rows). */
  queryByFilter(filter: Filter, limit = 50): MemoryRecord[] {
    return applyQuery(this.listAll(), filter, limit);
  }

  markSuperseded(oldAddr: string, newAddr: string): boolean {
    const res = this.db
      .prepare("UPDATE mirror SET status = 'superseded', supersedes = ? WHERE addr = ? AND status != 'revoked'")
      .run(newAddr, oldAddr.toUpperCase());
    return res.changes > 0;
  }

  markRevoked(addr: string): boolean {
    const res = this.db
      .prepare("UPDATE mirror SET status = 'revoked' WHERE addr = ?")
      .run(addr.toUpperCase());
    return res.changes > 0;
  }

  // ── resident memory (pinned) ────────────────────────────────────────────

  setPinned(addr: string, pinned: boolean): boolean {
    const res = pinned
      ? this.db
          .prepare("UPDATE mirror SET pinned = 1, pinned_at = ? WHERE addr = ?")
          .run(new Date().toISOString(), addr.toUpperCase())
      : this.db
          .prepare("UPDATE mirror SET pinned = 0, pinned_at = NULL WHERE addr = ?")
          .run(addr.toUpperCase());
    return res.changes > 0;
  }

  listPinned(): MemoryRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM mirror WHERE pinned = 1 AND status = 'active' ORDER BY pinned_at")
      .all() as Row[];
    return rows.map(rowToRecord);
  }

  // ── cache telemetry ─────────────────────────────────────────────────────

  recordTelemetry(input: { sessionId?: string; cacheRead: number; cacheWrite: number; inputTokens: number }): void {
    this.db
      .prepare("INSERT INTO telemetry (ts, session_id, cache_read, cache_write, input_tokens) VALUES (?, ?, ?, ?, ?)")
      .run(new Date().toISOString(), input.sessionId ?? null, input.cacheRead, input.cacheWrite, input.inputTokens);
  }

  telemetrySummary(): {
    requests: number;
    totalInput: number;
    totalCacheRead: number;
    hitRate: number;
  } {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n, COALESCE(SUM(input_tokens),0) AS inp, COALESCE(SUM(cache_read),0) AS cr FROM telemetry",
      )
      .get() as { n: number; inp: number; cr: number };
    const hitRate = row.inp > 0 ? row.cr / row.inp : 0;
    return { requests: row.n, totalInput: row.inp, totalCacheRead: row.cr, hitRate };
  }

  deleteAll(): number {
    const res = this.db.prepare("DELETE FROM mirror").run();
    return res.changes;
  }

  /** Quick check whether a record exists (by backend key) — used by rebuild for idempotency. */
  hasBackendKey(backend: string, backendKey: string): boolean {
    const row = this.db
      .prepare("SELECT 1 FROM mirror WHERE backend = ? AND backend_key = ? LIMIT 1")
      .get(backend, backendKey);
    return row !== undefined;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // already closed
    }
  }
}
