/** adapters/types.ts — unified backend interface. */
import type { MemoryRecord } from "../query.ts";

/**
 * A memory backend is a *source of truth*. The mirror is only a projection.
 * Adapters enumerate records and expand full content lazily.
 */
export interface BackendAdapter {
  readonly id: string;
  readonly label: string;

  /** Enumerate all records currently known to this backend. */
  listRecords(): Promise<MemoryRecord[]>;

  /** Expand the full original content for a record (or null when unavailable). */
  expand(record: MemoryRecord): Promise<string | null>;
}
