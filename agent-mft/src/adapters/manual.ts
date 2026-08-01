/**
 * adapters/manual.ts — adapter for manual memories (mem_add tool).
 *
 * Manual records live directly in the mirror (backend "manual"); the mirror
 * itself is their truth. The adapter therefore enumerates nothing from
 * external files; rebuild keeps manual records as-is, and expand returns the
 * stored content snapshot.
 */
import type { MemoryRecord } from "../query.ts";
import type { BackendAdapter } from "./types.ts";

export class ManualAdapter implements BackendAdapter {
  readonly id = "manual";
  readonly label = "manual memories (mem_add)";

  /** Manual records are re-enumerated from the mirror by rebuild. */
  async listRecords(): Promise<MemoryRecord[]> {
    return [];
  }

  async expand(record: MemoryRecord): Promise<string | null> {
    return (record.meta?.content as string) ?? record.filename;
  }
}

export default ManualAdapter;
