/**
 * adapters/chendpoc.ts — adapter for @chendpoc/pi-memory MEMORY.md ground truth.
 *
 * Parses the same format as chendpoc's own parser (section headers + bullet
 * entries with optional `<!-- id:... ts:... -->` meta and `[user]` prefix).
 * Overflow files `auto-*.md` are resolved via pointer lines and directory scan.
 */
import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { MemoryRecord } from "../query.ts";
import { chendpocMemoryDir } from "../utils/paths.ts";
import type { BackendAdapter } from "./types.ts";

const SECTION_RE = /^##\s+(Preferences|Conventions|Findings|Todos)\s*$/;
const ENTRY_META_RE = /<!--\s*id:([^\s]+)(?:\s+user)?(?:\s+ts:([^\s]+))?\s*-->/;
const USER_PREFIX_RE = /^\[user\]\s+/;
const OVERFLOW_POINTER_RE = /^-\s*\(overflow\)\s*→\s*(auto-[\w-]+\.md)\s*(?:<!--.*?-->)?\s*$/;
const AUTO_FILE_RE = /^auto-[\w-]+\.md$/;

/** kind mapping from chendpoc sections to MFT kinds. */
export const SECTION_KIND: Record<string, MemoryRecord["kind"]> = {
  Preferences: "preference",
  Conventions: "note",
  Findings: "fact",
  Todos: "task_state",
};

export interface ParsedEntry {
  id: string;
  section: string;
  content: string;
  userAuthored: boolean;
  timestamp: string;
  file: string;
  line: number;
}

/** Parse MEMORY.md format (mirrors chendpoc's parser). */
export function parseMemoryMarkdown(content: string, file: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  let section: string | undefined;
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      section = sectionMatch[1]!;
      continue;
    }
    if (!section || !line.startsWith("- ")) continue;
    if (OVERFLOW_POINTER_RE.test(line)) continue;

    const metaMatch = line.match(ENTRY_META_RE);
    const id = metaMatch?.[1] ?? `${basename(file)}:${i + 1}`;
    const timestamp = metaMatch?.[2] ?? "";
    let body = line.slice(2).replace(ENTRY_META_RE, "").trim();
    const userAuthored = USER_PREFIX_RE.test(body);
    if (userAuthored) body = body.replace(USER_PREFIX_RE, "").trim();
    if (!body) continue;

    entries.push({ id, section, content: body, userAuthored, timestamp, file, line: i + 1 });
  }
  return entries;
}

export function listOverflowPointers(content: string): string[] {
  const files: string[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(OVERFLOW_POINTER_RE);
    if (m?.[1]) files.push(m[1]);
  }
  return files;
}

export class ChendpocAdapter implements BackendAdapter {
  readonly id = "chendpoc";
  readonly label = "@chendpoc/pi-memory (MEMORY.md)";
  private readonly memoryDir: string;

  constructor(memoryDir: string = chendpocMemoryDir()) {
    this.memoryDir = memoryDir;
  }

  private async readAllFiles(): Promise<{ file: string; content: string }[]> {
    const mainFile = join(this.memoryDir, "MEMORY.md");
    const files: { file: string; content: string }[] = [];
    let main: string | null = null;
    try {
      main = await readFile(mainFile, "utf8");
    } catch {
      return files; // not installed / not initialized
    }
    files.push({ file: mainFile, content: main });

    // overflow files: pointer lines + directory scan (dedup)
    const overflow = new Set<string>(listOverflowPointers(main));
    try {
      for (const f of await readdir(this.memoryDir)) {
        if (AUTO_FILE_RE.test(f)) overflow.add(f);
      }
    } catch {
      // dir missing
    }
    for (const f of overflow) {
      const p = join(this.memoryDir, f);
      try {
        files.push({ file: p, content: await readFile(p, "utf8") });
      } catch {
        // skip missing
      }
    }
    return files;
  }

  async listRecords(): Promise<MemoryRecord[]> {
    const records: MemoryRecord[] = [];
    for (const { file, content } of await this.readAllFiles()) {
      for (const e of parseMemoryMarkdown(content, file)) {
        const kind = SECTION_KIND[e.section] ?? "note";
        records.push({
          addr: "", // assigned by rebuild
          backend_key: e.id,
          filename: e.content.slice(0, 120),
          kind,
          ts: e.timestamp || undefined,
          importance: e.userAuthored ? 0.7 : 0.5,
          status: "active",
          src: `chendpoc:${basename(file)}:${e.line}`,
          backend: "chendpoc",
          meta: { section: e.section, userAuthored: e.userAuthored, fullContent: e.content },
        });
      }
    }
    return records;
  }

  async expand(record: MemoryRecord): Promise<string | null> {
    return (record.meta?.fullContent as string) ?? record.filename;
  }
}

export default ChendpocAdapter;
