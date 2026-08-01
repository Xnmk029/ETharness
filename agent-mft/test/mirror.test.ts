import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mirror } from "../src/mirror.ts";
import { parseQuery } from "../src/query.ts";
import type { MemoryRecord } from "../src/query.ts";

let dir: string;
let dbPath: string;
let mirror: Mirror;

function rec(partial: Partial<MemoryRecord> & { backend_key: string }): MemoryRecord {
  return {
    addr: mirror.nextAddr(),
    filename: "测试记忆",
    kind: "decision",
    importance: 0.5,
    status: "active",
    src: "chendpoc:MEMORY.md:1",
    backend: "chendpoc",
    ...partial,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-mft-"));
  dbPath = join(dir, "mirror.sqlite");
  mirror = new Mirror(dbPath);
});

test("nextAddr allocates unique addresses", () => {
  const a = mirror.nextAddr();
  const b = mirror.nextAddr();
  assert.notEqual(a, b);
  assert.equal(mirror.peekSeq(), 2);
});

test("upsert + getByAddr", () => {
  const r = rec({ backend_key: "k1", filename: "采用 SQLite WAL 作为存储层", entity: "storage" });
  mirror.upsert(r);
  const got = mirror.getByAddr(r.addr);
  assert.equal(got?.filename, r.filename);
  assert.equal(got?.entity, "storage");
  assert.equal(mirror.count(), 1);
});

test("upsert overwrites by addr", () => {
  const r = rec({ backend_key: "k1", filename: "旧" });
  mirror.upsert(r);
  mirror.upsert({ ...r, filename: "新" });
  assert.equal(mirror.count(), 1);
  assert.equal(mirror.getByAddr(r.addr)?.filename, "新");
});

test("queryByFilter: keywords + kind + imp", () => {
  mirror.bulkUpsert([
    rec({ backend_key: "k1", filename: "采用 SQLite WAL 作为存储层", kind: "decision", importance: 0.9 }),
    rec({ backend_key: "k2", filename: "用户偏好零原生依赖", kind: "preference", importance: 0.8, entity: "user" }),
    rec({ backend_key: "k3", filename: "PostgreSQL 调研笔记", kind: "fact", importance: 0.3 }),
  ]);
  const out = mirror.queryByFilter(parseQuery("sqlite type:decision"));
  assert.equal(out.length, 1);
  assert.equal(out[0]!.backend_key, "k1");

  const prefs = mirror.queryByFilter(parseQuery("type:preference entity:user"));
  assert.equal(prefs.length, 1);

  const none = mirror.queryByFilter(parseQuery("type:decision imp:>0.95"));
  assert.equal(none.length, 0);
});

test("markSuperseded / markRevoked", () => {
  const old = rec({ backend_key: "k1" });
  const next = rec({ backend_key: "k2" });
  mirror.bulkUpsert([old, next]);
  assert.ok(mirror.markSuperseded(old.addr, next.addr));
  const got = mirror.getByAddr(old.addr);
  assert.equal(got?.status, "superseded");
  assert.equal(got?.supersedes, next.addr);
  assert.ok(mirror.markRevoked(next.addr));
  assert.equal(mirror.getByAddr(next.addr)?.status, "revoked");
});

test("deleteAll + rebuild idempotency via hasBackendKey", () => {
  mirror.bulkUpsert([
    rec({ backend_key: "k1" }),
    rec({ backend_key: "k2" }),
  ]);
  assert.equal(mirror.count(), 2);
  assert.ok(mirror.hasBackendKey("chendpoc", "k1"));
  mirror.deleteAll();
  assert.equal(mirror.count(), 0);
  assert.ok(!mirror.hasBackendKey("chendpoc", "k1"));
});

test("mirror persists across reopen", () => {
  const r = rec({ backend_key: "persist" });
  mirror.upsert(r);
  mirror.close();

  const reopened = new Mirror(dbPath);
  assert.equal(reopened.getByAddr(r.addr)?.filename, r.filename);
  // addr counter persisted too
  assert.equal(reopened.peekSeq(), 1);
  reopened.close();
});
