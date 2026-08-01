import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChendpocAdapter, parseMemoryMarkdown, listOverflowPointers } from "../src/adapters/chendpoc.ts";
import { ObsAdapter } from "../src/adapters/obs.ts";

// ── parseMemoryMarkdown ────────────────────────────────────────────────────

test("parseMemoryMarkdown: sections and entries", () => {
  const md = `# Memory

## Preferences

- [user] 用户偏好零原生依赖 <!-- id:pref1 ts:2026-07-30T10:00:00.000 -->

## Findings

- 采用 SQLite WAL 作为存储层
- (overflow) → auto-extra.md

## Todos

- [user] 完成镜像同步 <!-- id:todo1 user -->
`;
  const entries = parseMemoryMarkdown(md, "MEMORY.md");
  assert.equal(entries.length, 3);
  assert.equal(entries[0]!.id, "pref1");
  assert.equal(entries[0]!.section, "Preferences");
  assert.equal(entries[0]!.content, "用户偏好零原生依赖");
  assert.equal(entries[0]!.userAuthored, true);
  assert.equal(entries[0]!.timestamp, "2026-07-30T10:00:00.000");
  assert.equal(entries[1]!.section, "Findings");
  assert.equal(entries[1]!.content, "采用 SQLite WAL 作为存储层");
  assert.equal(entries[2]!.section, "Todos");
  assert.equal(entries[2]!.content, "完成镜像同步");
  assert.equal(entries[2]!.userAuthored, true);
});

test("listOverflowPointers", () => {
  const md = "- (overflow) → auto-2026-07.md\n- normal entry\n- (overflow) → auto-extra.md";
  assert.deepEqual(listOverflowPointers(md), ["auto-2026-07.md", "auto-extra.md"]);
});

// ── ChendpocAdapter (fixture dir) ──────────────────────────────────────────

let dir: string;
function makeChendpocFixture(): string {
  dir = mkdtempSync(join(tmpdir(), "mft-chendpoc-"));
  writeFileSync(
    join(dir, "MEMORY.md"),
    `# Memory

## Preferences

- [user] 用户偏好零原生依赖 <!-- id:pref1 ts:2026-07-30T10:00:00.000 -->

## Findings

- 采用 SQLite WAL 作为存储层
- (overflow) → auto-extra.md

## Todos
`,
    "utf8",
  );
  writeFileSync(join(dir, "auto-extra.md"), `## Findings\n\n- PostgreSQL 调研完成 <!-- id:extra1 -->\n`, "utf8");
  return dir;
}

test("ChendpocAdapter.listRecords enumerates main + overflow", async () => {
  const dir2 = makeChendpocFixture();
  try {
    const adapter = new ChendpocAdapter(dir2);
    const records = await adapter.listRecords();
    assert.equal(records.length, 3);
    const byKey = new Map(records.map((r) => [r.backend_key, r]));
    assert.ok(byKey.has("pref1"));
    assert.ok(byKey.has("extra1"));
    const pref = byKey.get("pref1")!;
    assert.equal(pref.kind, "preference");
    assert.equal(pref.importance, 0.7); // user authored
    const fact = records.find((r) => r.filename.includes("SQLite"))!;
    assert.equal(fact.kind, "fact");
    assert.equal(fact.backend, "chendpoc");
    assert.equal(await adapter.expand(fact), "采用 SQLite WAL 作为存储层");
  } finally {
    rmSync(dir2, { recursive: true, force: true });
  }
});

test("ChendpocAdapter on missing dir returns empty", async () => {
  const adapter = new ChendpocAdapter(join(tmpdir(), "mft-missing-" + Date.now()));
  assert.deepEqual(await adapter.listRecords(), []);
});

// ── ObsAdapter (fixture session JSONL) ─────────────────────────────────────

function makeObsFixture(): string {
  const d = mkdtempSync(join(tmpdir(), "mft-obs-"));
  const sessDir = join(d, "--G--test-proj--");
  writeFileSync(join(d, "placeholder"), "", "utf8"); // ensure dir exists for walker
  // create the session dir explicitly
  mkdirSync(sessDir, { recursive: true });
  const file = join(sessDir, "2026-08-01T00-00-00-000Z_abc.jsonl");
  writeFileSync(
    file,
    [
      JSON.stringify({ type: "session", id: "hdr", ts: "2026-08-01T00:00:00.000Z" }),
      JSON.stringify({
        type: "custom",
        customType: "om.observations.recorded",
        id: "obs1",
        timestamp: "2026-08-01T00:01:00.000Z",
        data: {
          coversUpToId: "x",
          observations: [
            {
              id: "a1b2c3d4e5f6",
              content: "用户决定从 REST 切换到 GraphQL",
              timestamp: "2026-08-01T00:00:30.000Z",
              relevance: "high",
              sourceEntryIds: ["src1"],
            },
            {
              id: "f6e5d4c3b2a1",
              content: "迁移完成并通过验证",
              timestamp: "2026-08-01T00:01:00.000Z",
              relevance: "medium",
              sourceEntryIds: ["src2"],
            },
          ],
        },
      }),
      JSON.stringify({
        type: "custom",
        customType: "om.reflections.recorded",
        id: "ref1",
        timestamp: "2026-08-01T00:02:00.000Z",
        data: {
          coversUpToId: "obs1",
          reflections: [{ id: "r9x8y7z6", content: "项目使用 Next.js 15 + Supabase auth", tokenCount: 8 }],
        },
      }),
      JSON.stringify({
        type: "message",
        id: "src1",
        message: { role: "user", content: [{ type: "text", text: "我们切到 GraphQL 吧" }] },
      }),
      JSON.stringify({
        type: "message",
        id: "src2",
        message: { role: "assistant", content: [{ type: "text", text: "迁移完成" }] },
      }),
    ].join("\n"),
    "utf8",
  );
  return d;
}

test("ObsAdapter.listRecords parses observations + reflections", async () => {
  const d = makeObsFixture();
  try {
    const adapter = new ObsAdapter(d);
    const records = await adapter.listRecords();
    assert.equal(records.length, 3);
    const obs = records.filter((r) => r.kind === "note");
    assert.equal(obs.length, 2);
    assert.equal(obs[0]!.importance, 0.7); // high
    assert.equal(obs[1]!.importance, 0.5); // medium
    assert.equal(records.find((r) => r.kind === "fact")?.filename, "项目使用 Next.js 15 + Supabase auth");
    assert.equal(records[0]!.project, "--G--test-proj--".replace(/^--|--$/g, ""));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("ObsAdapter.expand replays source entries", async () => {
  const d = makeObsFixture();
  try {
    const adapter = new ObsAdapter(d);
    const records = await adapter.listRecords();
    const graphql = records.find((r) => r.filename.includes("GraphQL"))!;
    const expanded = await adapter.expand(graphql);
    assert.ok(expanded?.includes("我们切到 GraphQL 吧"), `expanded: ${expanded}`);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("ObsAdapter on missing root returns empty", async () => {
  const adapter = new ObsAdapter(join(tmpdir(), "mft-obs-missing-" + Date.now()));
  assert.deepEqual(await adapter.listRecords(), []);
});
