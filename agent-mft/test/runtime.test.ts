import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MftRuntime } from "../src/runtime.ts";
import { parseQuery } from "../src/query.ts";

let dir: string;
let cwd: string;
let savedGlobalDb: string | undefined;
let runtime: MftRuntime;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mft-runtime-"));
  cwd = join(dir, "project");
  savedGlobalDb = process.env.MFT_GLOBAL_DB;
  process.env.MFT_GLOBAL_DB = join(dir, "global-mirror.sqlite");
  runtime = MftRuntime.open(cwd);
});

afterEach(() => {
  runtime.close();
  if (savedGlobalDb === undefined) delete process.env.MFT_GLOBAL_DB;
  else process.env.MFT_GLOBAL_DB = savedGlobalDb;
  rmSync(dir, { recursive: true, force: true });
});

test("open creates dual mirrors", () => {
  assert.ok(runtime.projectMirror !== null);
  assert.equal(runtime.globalMirror.count(), 0);
  assert.equal(runtime.projectMirror!.count(), 0);
});

test("addManual writes to project + global mirrors", () => {
  const rec = runtime.addManual({
    filename: "采用 SQLite WAL 作为存储层",
    kind: "decision",
    entity: "storage",
    importance: 0.9,
  });
  assert.ok(rec.addr.length >= 4);
  assert.equal(runtime.projectMirror!.count(), 1);
  assert.equal(runtime.globalMirror.count(), 1);
  const got = runtime.getByAddr(rec.addr);
  assert.equal(got?.filename, "采用 SQLite WAL 作为存储层");
});

test("merged query dedupes by backend key", () => {
  const rec = runtime.addManual({ filename: "测试", kind: "note" });
  // both mirrors hold the same backend key → merged view has exactly 1
  assert.equal(runtime.allRecords().length, 1);
  assert.equal(runtime.query(parseQuery("测试")).length, 1);
  assert.equal(runtime.query(parseQuery("type:note")).length, 1);
});

test("supersede + revoke propagate to both mirrors", () => {
  const a = runtime.addManual({ filename: "旧决策", kind: "decision" });
  const b = runtime.addManual({ filename: "新决策", kind: "decision" });
  assert.ok(runtime.supersede(a.addr, b.addr));
  assert.equal(runtime.getByAddr(a.addr)?.status, "superseded");
  assert.equal(runtime.getByAddr(b.addr)?.status, "active");
  // default queries exclude superseded (status filter)
  assert.equal(runtime.query(parseQuery("status:active")).length, 1);
  assert.ok(runtime.revoke(b.addr));
  assert.equal(runtime.getByAddr(b.addr)?.status, "revoked");
});

test("evaluateInjection: no candidates → nothing", () => {
  assert.deepEqual(runtime.evaluateInjection("继续做项目"), []);
});

test("evaluateInjection: keyword hit injects", () => {
  runtime.addManual({ filename: "采用 SQLite WAL 作为存储层", kind: "decision", importance: 0.9 });
  const injected = runtime.evaluateInjection("之前我们决定用 SQLite 吗？");
  assert.equal(injected.length, 1);
  assert.equal(injected[0]!.filename, "采用 SQLite WAL 作为存储层");
});

test("evaluateInjection: high importance triggers without keyword", () => {
  runtime.addManual({ filename: "项目截止日期是下周五", kind: "task_state", importance: 0.95 });
  const injected = runtime.evaluateInjection("今天做什么？");
  assert.equal(injected.length, 1);
});

test("evaluateInjection: off config disables", () => {
  runtime.config.inject = "off";
  runtime.addManual({ filename: "重要决策", kind: "decision", importance: 0.95 });
  assert.deepEqual(runtime.evaluateInjection("重要"), []);
});

test("renderMemoryMap format", () => {
  const rec = runtime.addManual({ filename: "采用 SQLite WAL", kind: "decision", importance: 0.9 });
  const map = runtime.renderMemoryMap([rec]);
  assert.ok(map.includes("## Memory Map"));
  assert.ok(map.includes(`#${rec.addr}`));
  assert.ok(map.includes("[decision]"));
  assert.ok(map.includes("采用 SQLite WAL"));
  assert.ok(map.includes("mem_get"));
});

// ── resident memory (pinned) ────────────────────────────────────────────────

test("residentRecords: pinned always included regardless of importance", () => {
  const low = runtime.addManual({ filename: "低优先级但钉住", kind: "note", importance: 0.2 });
  runtime.pin(low.addr);
  const hi = runtime.addManual({ filename: "高优先级自动常驻", kind: "decision", importance: 0.9 });
  const mid = runtime.addManual({ filename: "中等不入常驻", kind: "fact", importance: 0.5 });
  const addrs = runtime.residentRecords().map((r) => r.addr);
  assert.ok(addrs.includes(low.addr), "pinned low-importance included");
  assert.ok(addrs.includes(hi.addr), "high importance auto-included");
  assert.ok(!addrs.includes(mid.addr), "mid importance excluded");
  // stable order: pinned first
  assert.equal(addrs[0], low.addr);
});

test("residentRecords: superseded/revoked excluded", () => {
  const a = runtime.addManual({ filename: "旧决策", kind: "decision", importance: 0.9 });
  const b = runtime.addManual({ filename: "新决策", kind: "decision", importance: 0.9 });
  runtime.pin(a.addr);
  runtime.supersede(a.addr, b.addr);
  const addrs = runtime.residentRecords().map((r) => r.addr);
  assert.ok(!addrs.includes(a.addr));
  assert.ok(addrs.includes(b.addr));
});

test("pin/unpin propagate to both mirrors", () => {
  const rec = runtime.addManual({ filename: "钉住测试", kind: "preference" });
  assert.ok(runtime.pin(rec.addr));
  assert.equal(runtime.projectMirror!.getByAddr(rec.addr)?.pinned, true);
  assert.equal(runtime.globalMirror.getByAddr(rec.addr)?.pinned, true);
  assert.ok(runtime.unpin(rec.addr));
  assert.equal(runtime.projectMirror!.getByAddr(rec.addr)?.pinned, false);
});

test("renderResidentBlock content", () => {
  const rec = runtime.addManual({ filename: "苏晚：左眼失明，怕黑但嘴硬", kind: "note", entity: "苏晚", importance: 0.3 });
  runtime.pin(rec.addr);
  const block = runtime.renderResidentBlock();
  assert.ok(block.includes("## Resident Memory"));
  assert.ok(block.includes(`#${rec.addr}`));
  assert.ok(block.includes("(pinned)"));
  assert.ok(block.includes("苏晚"));
});

// ── cache telemetry ─────────────────────────────────────────────────────────

test("cacheStats: hit rate + estimated savings", () => {
  runtime.recordCacheUsage({ cacheRead: 100_000, cacheWrite: 0, inputTokens: 1_000_000 });
  const s = runtime.cacheStats();
  assert.equal(s.requests, 1);
  assert.equal(s.totalInput, 1_000_000);
  assert.ok(Math.abs(s.hitRate - 0.1) < 0.001);
  // saved = cacheRead/1M * (0.14 - 0.0028) = 0.1 * 0.1372
  assert.ok(Math.abs(s.estimatedSavedUsd - 0.01372) < 0.0001);
});
