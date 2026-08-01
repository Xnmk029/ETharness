import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseQuery,
  parseDuration,
  matches,
  query,
  sortByScore,
  QueryParseError,
  type MemoryRecord,
} from "../src/query.ts";

function rec(partial: Partial<MemoryRecord>): MemoryRecord {
  return {
    addr: "A1F3",
    filename: "采用 SQLite WAL 作为存储层",
    kind: "decision",
    importance: 0.9,
    status: "active",
    src: "chendpoc:MEMORY.md:12",
    backend: "chendpoc",
    ts: "2026-07-18T00:00:00Z",
    ...partial,
  };
}

test("parseDuration accepts units", () => {
  assert.equal(parseDuration("1h"), 3_600_000);
  assert.equal(parseDuration("2w"), 2 * 604_800_000);
  assert.equal(parseDuration("0.5d"), 43_200_000);
  assert.equal(parseDuration("3m"), 3 * 2_592_000_000);
  assert.equal(parseDuration("1y"), 31_536_000_000);
  assert.equal(parseDuration("5x"), null);
  assert.equal(parseDuration(""), null);
  assert.equal(parseDuration("abc"), null);
});

test("parseQuery: plain keywords", () => {
  const f = parseQuery("sqlite wal");
  assert.deepEqual(f.keywords, ["sqlite", "wal"]);
});

test("parseQuery: type with comma list", () => {
  const f = parseQuery("type:decision,fact");
  assert.deepEqual(f.kind, ["decision", "fact"]);
  assert.throws(() => parseQuery("type:unknown"), QueryParseError);
});

test("parseQuery: entity/path/backend/status", () => {
  const f = parseQuery("entity:auth path:projA/arch backend:obs status:active");
  assert.equal(f.entity, "auth");
  assert.equal(f.path, "projA/arch");
  assert.equal(f.backend, "obs");
  assert.equal(f.status, "active");
});

test("parseQuery: since", () => {
  const before = Date.now();
  const f = parseQuery("since:2w");
  assert.ok(f.since !== undefined);
  assert.ok(f.since <= before && f.since >= before - 2 * 604_800_000 - 1000);
  assert.throws(() => parseQuery("since:abc"), QueryParseError);
});

test("parseQuery: imp comparisons", () => {
  assert.deepEqual(parseQuery("imp:>0.7").imp, { op: ">", value: 0.7 });
  assert.deepEqual(parseQuery("imp:>=0.5").imp, { op: ">=", value: 0.5 });
  assert.deepEqual(parseQuery("imp:<0.3").imp, { op: "<", value: 0.3 });
  assert.throws(() => parseQuery("imp:0.7"), QueryParseError);
  assert.throws(() => parseQuery("imp:>1.5"), QueryParseError);
});

test("parseQuery: address", () => {
  const f = parseQuery("#A1F3");
  assert.equal(f.addr, "A1F3");
  assert.throws(() => parseQuery("#A1F3 #B7C2"), QueryParseError);
});

test("parseQuery: exclusions", () => {
  const f = parseQuery("sqlite --type:note --entity:user --backend:obs");
  assert.equal(f.excludes.length, 3);
  assert.ok(f.excludes.some((e) => e.type === "kind" && e.value === "note"));
  assert.ok(f.excludes.some((e) => e.type === "entity" && e.value === "user"));
  assert.ok(f.excludes.some((e) => e.type === "backend" && e.value === "obs"));
});

test("parseQuery: unknown key treated as keyword", () => {
  const f = parseQuery("foo:bar");
  assert.deepEqual(f.keywords, ["foo:bar"]);
});

test("matches: keyword substring (Chinese)", () => {
  const f = parseQuery("SQLite");
  assert.ok(matches(rec({}), f));
  assert.ok(!matches(rec({ filename: "PostgreSQL" }), f));
});

test("matches: type + entity + importance", () => {
  const f = parseQuery("type:decision entity:auth imp:>0.8");
  assert.ok(matches(rec({ entity: "auth" }), f));
  assert.ok(!matches(rec({ kind: "fact" }), f));
  assert.ok(!matches(rec({ entity: "storage" }), f));
  assert.ok(!matches(rec({ importance: 0.5 }), f));
});

test("matches: since window", () => {
  const f = parseQuery("since:2w");
  assert.ok(matches(rec({ ts: new Date(Date.now() - 86_400_000).toISOString() }), f));
  assert.ok(!matches(rec({ ts: "2026-01-01T00:00:00Z" }), f));
  assert.ok(matches(rec({ ts: undefined }), f) === false);
});

test("matches: exclusion", () => {
  const f = parseQuery("wal --entity:storage");
  assert.ok(matches(rec({}), f));
  assert.ok(!matches(rec({ entity: "storage" }), f));
});

test("query: sorts by score and limits", () => {
  const records = [
    rec({ addr: "A001", importance: 0.3, ts: new Date().toISOString() }),
    rec({ addr: "A002", importance: 1.0, ts: "2026-01-01T00:00:00Z" }),
    rec({ addr: "A003", importance: 0.7, ts: new Date().toISOString() }),
  ];
  const out = query(records, parseQuery(""), 2);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.addr, "A003"); // high imp + recent beats old imp 1.0
});

test("sortByScore: recency decay", () => {
  const old = rec({ addr: "OLD", importance: 1.0, ts: "2026-01-01T00:00:00Z" });
  const fresh = rec({ addr: "NEW", importance: 0.6, ts: new Date().toISOString() });
  const sorted = sortByScore([old, fresh]);
  assert.equal(sorted[0]!.addr, "NEW");
});
