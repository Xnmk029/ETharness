/** paths.ts — resolved locations for backends and mirrors. */
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_DIR_NAME = ".pi";

export function home(): string {
  return homedir();
}

/** chendpoc memory data root (override with MFT_MEMORY_DIR). */
export function chendpocMemoryDir(): string {
  return process.env.MFT_MEMORY_DIR ?? join(home(), ".pi", "pi-memory-data");
}

/** pi session root (override with MFT_SESSIONS_DIR). */
export function sessionsDir(): string {
  return process.env.MFT_SESSIONS_DIR ?? join(home(), ".pi", "agent", "sessions");
}

/** Global mirror database. */
export function globalMirrorPath(): string {
  return process.env.MFT_GLOBAL_DB ?? join(home(), ".pi", "agent", "agent-mft", "mirror.sqlite");
}

/** Project-local mirror database. */
export function projectMirrorPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, "agent-mft", "mirror.sqlite");
}

/** MFT data root (state, logs). */
export function mftDataDir(): string {
  return process.env.MFT_DATA_DIR ?? join(home(), ".pi", "agent", "agent-mft");
}
