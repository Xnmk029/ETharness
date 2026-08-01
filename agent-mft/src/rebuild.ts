/**
 * rebuild.ts — cross-session rebuildable projection.
 *
 * Backends are the source of truth; the mirror is a projection. Rebuild:
 *   1. reads existing addr mapping (backend_key → addr) so addresses stay stable
 *   2. enumerates all adapters (including manual records kept in the mirror)
 *   3. wipes the mirror and re-inserts everything with stable addresses
 * Manual (backend "manual") records are preserved from the old mirror.
 */
import type { Mirror } from "./mirror.ts";
import type { MemoryRecord } from "./query.ts";
import type { BackendAdapter } from "./adapters/types.ts";

export interface RebuildReport {
  total: number;
  newAddrs: number;
  keptAddrs: number;
  byBackend: Record<string, number>;
  durationMs: number;
  errors: string[];
}

export async function rebuild(mirror: Mirror, adapters: BackendAdapter[]): Promise<RebuildReport> {
  const started = Date.now();
  const errors: string[] = [];

  // 1. existing mapping for stable addresses
  const oldRecords = mirror.listAll();
  const addrByKey = new Map<string, string>();
  for (const r of oldRecords) {
    addrByKey.set(`${r.backend}:${r.backend_key}`, r.addr);
  }

  // 2. enumerate all adapters
  const records: MemoryRecord[] = [];
  const seenKeys = new Set<string>();

  for (const adapter of adapters) {
    try {
      const list = await adapter.listRecords();
      for (const r of list) {
        const key = `${r.backend}:${r.backend_key}`;
        if (seenKeys.has(key)) continue; // dedupe across adapters
        seenKeys.add(key);
        const oldAddr = addrByKey.get(key);
        r.addr = oldAddr ?? mirror.nextAddr();
        records.push(r);
      }
    } catch (e) {
      errors.push(`${adapter.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3. manual records: preserved from old mirror (their truth is the mirror itself)
  for (const r of oldRecords) {
    if (r.backend === "manual" && !seenKeys.has("manual:" + r.backend_key)) {
      records.push(r);
      seenKeys.add("manual:" + r.backend_key);
    }
  }

  // 4. wipe + re-insert
  const newAddrs = records.filter((r) => addrByKey.has(`${r.backend}:${r.backend_key}`) === false).length;
  mirror.deleteAll();
  mirror.bulkUpsert(records);

  const byBackend: Record<string, number> = {};
  for (const r of records) byBackend[r.backend] = (byBackend[r.backend] ?? 0) + 1;

  return {
    total: records.length,
    newAddrs,
    keptAddrs: records.length - newAddrs,
    byBackend,
    durationMs: Date.now() - started,
    errors,
  };
}
