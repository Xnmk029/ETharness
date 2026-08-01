/**
 * query.ts — Everything-style addressing engine for Agent MFT.
 *
 * Grammar (v1):
 *   <expr> := <term> ( <space> <term> )*
 *   <term> := <keyword>                    filename substring match
 *           | type:<kind>                  decision|fact|preference|task_state|entity_rel|commit|note
 *           | entity:<name>                entity (normalized)
 *           | path:<a/b>                   hierarchical prefix
 *           | backend:<id>                 obs|chendpoc|mirror|manual
 *           | since:<1h|1d|2w|3m|1y>       relative time window
 *           | imp:>0.7                     importance comparison (> < >= <=)
 *           | status:active|superseded|revoked
 *           | #<ADDR>                      deterministic address
 *           | --<term>                     exclusion (keyword|type|entity|path|backend|status)
 *
 * Examples:
 *   type:decision entity:auth since:2w imp:>0.6 --backend:obs
 *   #A1F3
 *   backend:chendpoc kind:preference status:active
 */

export type Kind =
  | "decision"
  | "fact"
  | "preference"
  | "task_state"
  | "entity_rel"
  | "commit"
  | "note"
  | "character"
  | "world"
  | "idea"
  | "material"
  | "plan"
  | "event"
  | "style";

export type Status = "active" | "superseded" | "revoked";

export type BackendId = "obs" | "chendpoc" | "mirror" | "manual";

export const KINDS: readonly Kind[] = [
  "decision",
  "fact",
  "preference",
  "task_state",
  "entity_rel",
  "commit",
  "note",
  // creative / life kinds (PRD §7)
  "character",
  "world",
  "idea",
  "material",
  "plan",
  "event",
  "style",
];

export const BACKENDS: readonly BackendId[] = ["obs", "chendpoc", "mirror", "manual"];

export interface ExcludeTerm {
  type: "keyword" | "kind" | "entity" | "path" | "backend" | "status";
  value: string;
}

export interface Filter {
  keywords: string[]; // all must match (filename substring)
  kind?: Kind | Kind[];
  entity?: string;
  path?: string; // prefix match
  backend?: BackendId;
  since?: number; // epoch ms — only records with ts >= since
  imp?: { op: ">" | "<" | ">=" | "<="; value: number };
  status?: Status;
  addr?: string;
  excludes: ExcludeTerm[];
  raw: string; // original expression for display
}

/** Unified memory record returned by every backend. */
export interface MemoryRecord {
  addr: string;
  backend_key: string; // backend-native key (ledger entry id / MEMORY.md line locator)
  filename: string;
  kind: Kind;
  entity?: string;
  entity2?: string;
  path?: string;
  project?: string;
  ts?: string; // ISO timestamp or undefined
  importance: number;
  status: Status;
  supersedes?: string;
  src: string; // backend locator for expansion
  backend: BackendId;
  meta?: Record<string, unknown>;
  pinned?: boolean; // resident memory flag (stable prefix)
  pinned_at?: string;
}

// ── time units ────────────────────────────────────────────────────────────

const TIME_UNITS: Record<string, number> = {
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  m: 2_592_000_000, // 30 days
  y: 31_536_000_000, // 365 days
};

export function parseDuration(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([hdwmy])$/.exec(s.trim());
  if (!m) return null;
  const unit = TIME_UNITS[m[2]!];
  if (!unit) return null;
  const n = Number.parseFloat(m[1]!);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * unit);
}

// ── tokenizer + parser ────────────────────────────────────────────────────

export class QueryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryParseError";
  }
}

/** Split an expression into whitespace-separated terms (quotes not supported in v1). */
export function tokenize(expr: string): string[] {
  return expr.trim().split(/\s+/).filter(Boolean);
}

const ADDR_RE = /^#([0-9A-Z]{1,8})$/i;

export function parseQuery(expr: string): Filter {
  const terms = tokenize(expr);
  const filter: Filter = { keywords: [], excludes: [], raw: expr.trim() };
  let sawAddr = false;

  for (const term of terms) {
    // exclusion
    if (term.startsWith("--")) {
      const inner = term.slice(2);
      if (!inner) throw new QueryParseError(`empty exclusion: ${term}`);
      const colon = inner.indexOf(":");
      if (colon > 0) {
        const key = inner.slice(0, colon).toLowerCase();
        const value = inner.slice(colon + 1);
        if (key === "type") filter.excludes.push({ type: "kind", value });
        else if (key === "entity") filter.excludes.push({ type: "entity", value: value.toLowerCase() });
        else if (key === "path") filter.excludes.push({ type: "path", value });
        else if (key === "backend") filter.excludes.push({ type: "backend", value: value.toLowerCase() });
        else if (key === "status") filter.excludes.push({ type: "status", value: value.toLowerCase() });
        else filter.excludes.push({ type: "keyword", value: inner });
      } else {
        filter.excludes.push({ type: "keyword", value: inner.toLowerCase() });
      }
      continue;
    }

    // deterministic address
    const addrMatch = ADDR_RE.exec(term);
    if (addrMatch) {
      if (sawAddr) throw new QueryParseError(`multiple addresses in expression: ${expr}`);
      sawAddr = true;
      filter.addr = addrMatch[1]!.toUpperCase();
      continue;
    }

    // key:value terms
    const colon = term.indexOf(":");
    if (colon > 0) {
      const key = term.slice(0, colon).toLowerCase();
      const value = term.slice(colon + 1);
      if (!value) throw new QueryParseError(`empty value for ${key}: in ${term}`);

      switch (key) {
        case "type": {
          const kinds = value.split(",").map((k) => k.trim().toLowerCase() as Kind);
          for (const k of kinds) {
            if (!KINDS.includes(k)) throw new QueryParseError(`unknown type: ${k}`);
          }
          filter.kind = kinds.length === 1 ? kinds[0]! : kinds;
          break;
        }
        case "entity":
          filter.entity = value.toLowerCase();
          break;
        case "path":
          filter.path = value.replace(/^\/+|\/+$/g, "");
          break;
        case "backend": {
          const b = value.toLowerCase() as BackendId;
          if (!BACKENDS.includes(b)) throw new QueryParseError(`unknown backend: ${b}`);
          filter.backend = b;
          break;
        }
        case "since": {
          const dur = parseDuration(value);
          if (dur === null) throw new QueryParseError(`invalid since: ${value} (use 1h|1d|2w|3m|1y)`);
          filter.since = Date.now() - dur;
          break;
        }
        case "imp": {
          const m = /^(>=|<=|>|<)\s*(\d+(?:\.\d+)?)$/.exec(value);
          if (!m) throw new QueryParseError(`invalid imp: ${value} (use imp:>0.7)`);
          const v = Number.parseFloat(m[2]!);
          if (v < 0 || v > 1) throw new QueryParseError(`imp out of range (0..1): ${value}`);
          filter.imp = { op: m[1] as ">" | "<" | ">=" | "<=", value: v };
          break;
        }
        case "status": {
          const s = value.toLowerCase() as Status;
          if (!["active", "superseded", "revoked"].includes(s))
            throw new QueryParseError(`unknown status: ${s}`);
          filter.status = s;
          break;
        }
        default:
          // unknown key: treat whole term as keyword
          filter.keywords.push(term.toLowerCase());
      }
      continue;
    }

    // plain keyword
    filter.keywords.push(term.toLowerCase());
  }

  return filter;
}

// ── matching ──────────────────────────────────────────────────────────────

function compareImp(recordImp: number, spec: { op: ">" | "<" | ">=" | "<="; value: number }): boolean {
  switch (spec.op) {
    case ">":
      return recordImp > spec.value;
    case "<":
      return recordImp < spec.value;
    case ">=":
      return recordImp >= spec.value;
    case "<=":
      return recordImp <= spec.value;
  }
}

function tsToMs(ts: string | undefined): number | null {
  if (!ts) return null;
  const n = Date.parse(ts);
  return Number.isNaN(n) ? null : n;
}

function kindMatches(recordKind: Kind, spec: Kind | Kind[] | undefined): boolean {
  if (!spec) return true;
  return Array.isArray(spec) ? spec.includes(recordKind) : spec === recordKind;
}

/** Pure matcher — usable by any backend over an in-memory record list. */
export function matches(record: MemoryRecord, filter: Filter): boolean {
  if (filter.addr && record.addr !== filter.addr) return false;

  if (filter.kind !== undefined && !kindMatches(record.kind, filter.kind)) return false;
  if (filter.entity !== undefined) {
    const ent = record.entity?.toLowerCase() ?? "";
    if (!ent.includes(filter.entity)) return false;
  }
  if (filter.path !== undefined && !(record.path ?? "").startsWith(filter.path)) return false;
  if (filter.backend !== undefined && record.backend !== filter.backend) return false;
  if (filter.status !== undefined && record.status !== filter.status) return false;
  if (filter.imp !== undefined && !compareImp(record.importance, filter.imp)) return false;
  if (filter.since !== undefined) {
    const t = tsToMs(record.ts);
    if (t === null || t < filter.since) return false;
  }

  for (const kw of filter.keywords) {
    if (!record.filename.toLowerCase().includes(kw)) return false;
  }

  for (const ex of filter.excludes) {
    switch (ex.type) {
      case "keyword":
        if (record.filename.toLowerCase().includes(ex.value)) return false;
        break;
      case "kind":
        if (record.kind === ex.value) return false;
        break;
      case "entity":
        if ((record.entity?.toLowerCase() ?? "").includes(ex.value)) return false;
        break;
      case "path":
        if ((record.path ?? "").startsWith(ex.value)) return false;
        break;
      case "backend":
        if (record.backend === ex.value) return false;
        break;
      case "status":
        if (record.status === ex.value) return false;
        break;
    }
  }

  return true;
}

// ── ordering ──────────────────────────────────────────────────────────────

/** Recency-decayed importance score; higher = better. */
export function score(record: MemoryRecord, now = Date.now()): number {
  const t = tsToMs(record.ts);
  let recency = 0.5;
  if (t !== null) {
    const ageDays = Math.max(0, (now - t) / 86_400_000);
    recency = Math.exp(-ageDays / 30); // half-life ~21 days
  }
  return record.importance * 0.7 + recency * 0.3;
}

export function sortByScore(records: MemoryRecord[], now = Date.now()): MemoryRecord[] {
  return [...records].sort((a, b) => score(b, now) - score(a, now));
}

/** Apply filter + sort + limit over an in-memory list. */
export function query(records: MemoryRecord[], filter: Filter, limit = 50): MemoryRecord[] {
  return sortByScore(records.filter((r) => matches(r, filter))).slice(0, limit);
}
