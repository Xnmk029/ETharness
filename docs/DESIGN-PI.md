# 记忆寻址层设计：基于 pi 基底的 Agent MFT（v0.3）

> 日期：2026-08-01 ｜ 状态：战略更新版
> 前置：`research/pi-memory-ecosystem.md`（生态调研）、`research/pi-memory-deepdive.md`（源码拆解）、`DESIGN.md`（v0.1 原始愿景）
> **v0.3 战略转向：从"自建记忆内核"改为"寻址层产品"——不做存储/注入/压缩，只做生态空白点。**

---

## 0. 战略更新：为什么转向

### 0.1 调研结论（2026-08-01 定稿）

1. pi 记忆扩展是**拥挤赛道**：npm 上 30+ 个记忆包，覆盖所有主流路线
2. 源码拆解确认：
   - `pi-observational-memory` V3 已实现**会话内 ledger 记忆 + 确定性零模型压缩**（fold 投影 ≈ 我们的"日志→投影→重建"纪律，且做到极致）
   - `@chendpoc/pi-memory` 已实现**跨会话 Markdown 记忆 + 双用途压缩摘要**（一次 LLM 调用同时产出 pi 摘要 + Memory Export 区块入库）——即"压缩后 LLM 复盘入库"
3. **仍无人做的空白点（本产品的全部差异化）**：
   - Everything 式**过滤语法**（`type:`/`entity:`/`since:`/`imp:`）
   - **确定性地址引用语言**（`#A1F3` 跨会话引用、supersede 链）
   - **跨会话可重建投影**（obs 的 ledger 纪律 × chendpoc 的跨会话范围）
   - **记忆浏览器**（Everything 式过滤/排序/展开）

### 0.2 原则

```
不造：存储（chendpoc/obs 已有）｜注入（chendpoc 已有）｜压缩（两者已有）｜脱敏（chendpoc 已有）
只造：寻址语法引擎 + 地址系统 + 跨后端查询层 + 记忆浏览器 + 跨会话重建投影
```

---

## 1. 产品定位

**Agent MFT = pi 的"Everything"**：一个挂接在现有记忆后端之上的寻址层，让 Agent 和用户用统一的过滤语法与地址语言，跨会话精确寻址任何记忆——无论记忆存在哪个后端。

```
用户/Agent
   │  mem_query "type:decision entity:auth since:2w"
   ▼
┌──────────────────────────────────────────────┐
│ Agent MFT 寻址层（本产品，薄）                 │
│  ├─ 寻址引擎（Everything 语法解析→统一查询）    │
│  ├─ 地址系统（确定性 addr + supersede 链）     │
│  ├─ 跨会话重建投影（适配器镜像索引）            │
│  ├─ /mft 记忆浏览器（TUI）                     │
│  └─ mem_query / mem_get / mem_supersede 工具   │
├───────────────┬──────────────┬───────────────┤
│ 适配器: obs   │ 适配器: chendpoc │ 适配器: 自建 │
│ (session ledger) │ (MEMORY.md+sidecar) │ (SQLite 镜像, 可选) │
└───────────────┴──────────────┴───────────────┘
```

---

## 2. 架构

```
~/.pi/agent/extensions/agent-mft/
├── index.ts          # 入口：命令 + 工具 + 注入钩子注册
├── query.ts          # 寻址引擎：语法解析 → 结构化过滤器 → 后端执行
├── addr.ts           # 地址系统：确定性 addr 分配/解析/引用
├── adapters/
│   ├── types.ts      # MemoryBackend 接口（统一抽象）
│   ├── obs.ts        # 适配 pi-observational-memory（session ledger 扫描 + recall）
│   ├── chendpoc.ts   # 适配 @chendpoc/pi-memory（MEMORY.md 解析 + sidecar 检索）
│   └── mirror.ts     # 自建 SQLite 镜像（可选：跨后端统一索引，node:sqlite）
├── browse.ts         # /mft 记忆浏览器（TUI 过滤/排序/展开）
├── rebuild.ts        # 跨会话重建投影（扫描各后端 → 镜像/地址索引）
└── inject.ts         # 首轮注入评估（子 Agent 判断）——见 §6
```

**后端无关的查询协议**：

```ts
interface MemoryBackend {
  id: string;                          // "obs" | "chendpoc" | "mirror"
  list(filter: Filter, opts): Promise<MemoryRecord[]>;
  get(addr: string): Promise<MemoryRecord | null>;   // 展开原文
  count(filter: Filter): Promise<number>;
  // MemoryRecord = { addr, filename, kind, entity, path, ts, importance, status, supersedes, src }
}
```

---

## 3. 寻址语法（v1 完整定义）

```
<expr> := <term> ( <space> <term> )*
<term> := <keyword>                    # filename 子串匹配（Everything 语义）
        | type:<kind>                  # decision|fact|preference|task_state|entity_rel|commit|note
        | entity:<name>                # 实体归一化匹配
        | path:<a/b>                   # 层级前缀
        | backend:<obs|chendpoc|mirror>  # 后端限定
        | since:<1h|1d|2w|3m|1y>       # 时间窗
        | imp:>0.7                     # 重要性（> < >= <=）
        | status:active|superseded|revoked
        | #<ADDR>                      # 确定性地址
        | --<term>                     # 排除
示例：
  type:decision entity:auth since:2w imp:>0.6 --backend:obs
  #A1F3
  backend:chendpoc kind:preference status:active
```

实现：token 化 → `Filter` 结构体 → 各后端翻译执行（obs 走 ledger 扫描、chendpoc 走文件解析/sidecar、mirror 走 SQL）。

---

## 4. 地址系统（addr.ts）

| 机制 | 说明 |
|---|---|
| 确定性地址 | 后端无关的 `A1F3` 式短码（Base36 自增+混淆），由寻址层分配并持久化在镜像/索引 |
| 地址即引用 | Agent 可写"看 #A1F3 那条决策"；`mem_get #A1F3` 跨后端展开 |
| supersede 链 | `mem_supersede #A1F3 #B7C2` → 旧记录标记 superseded，可追溯决策演变 |
| 地址持久化 | 镜像表（mirror.sqlite）存 `addr ↔ (backend, backendKey)` 映射，跨会话稳定 |

**不接管后端自身的 ID**：obs 的 12 字符 ID、chendpoc 的条目路径保持原样，地址是寻址层附加的统一引用层。

---

## 5. 适配器设计

### 5.1 obs 适配器（会话内 ledger）

- `list`：扫描 `~/.pi/agent/sessions/--<path>--/*.jsonl` 当前分支的 `om.observations.recorded` / `om.reflections.recorded` 条目
- `get`：按 `sourceEntryIds` 回放源条目（等价 obs 的 recall）
- 局限：obs 是会话内——跨会话寻址只能拿到"当前会话的观察/反思"（+ 已压缩进 summary 的内容）

### 5.2 chendpoc 适配器（跨会话 Markdown）

- `list`：解析 `~/.pi/agent/pi-memory/MEMORY.md` + `auto-*.md`（Preference/Convention/Findings/Todos 区块 → kind 映射）
- `get`：按条目定位展开
- 局限：条目无时间戳/实体字段 → 寻址层在镜像中补充（首见时间、来源会话）

### 5.3 mirror 镜像（可选，推荐启用）

- 自建 `node:sqlite` 表：`addr, backend, backend_key, filename, kind, entity, path, ts, importance, status, supersedes, src`
- 定期/事件驱动增量同步（`session_start`、`session_compact`、`/mft:rebuild` 时）
- **这是"跨会话可重建投影"的落点**：镜像可从各后端完整重建（`/mft:rebuild`），后端为真相、镜像为投影
- 查询优先走镜像（快），`mem_get` 时回后端展开原文

---

## 6. 调用设计（按用户新要求修订）

### 6.1 不再"每次会话开启自动注入"

**改为"首轮评估 + 手动开启"双模式**（用户意见 3）：

```
用户发起第一轮对话
  ├─ 评估模式（默认）：触发一个轻量子 Agent（子 Agent 或辅助模型调用）
  │   输入：当前提示词 + 项目上下文 + 镜像 top-N 候选
  │   输出：{ inject: boolean, reason, top_addrs: string[] }
  │   → inject=true 时注入记忆地图（message），否则不注入（零开销）
  └─ 手动模式：/mft:inject 或 GUI 按钮 → 立即注入当前项目记忆地图
```

- 首轮评估的子 Agent 调用走**便宜模型**（如 `--memory-helper-model` 或当前模型低思考档），预算受限（如 ≤ 3s / ≤ 2000 token）
- 记忆地图格式沿用 v0.2（每行：地址 [kind] filename（entity, path, 相对时间, imp））
- **用户可配**：`"agent-mft": { "inject": "auto" | "ask" | "off", "evaluateModel": {...} }`

### 6.2 压缩策略：复用，不造

| 场景 | 策略 |
|---|---|
| 会话内长会话压缩 | obs 的确定性压缩（已装则生效，零成本） |
| 压缩后 LLM 复盘入库 | chendpoc 双用途摘要（已装则生效，一次调用双产出） |
| 项目级→全局入库（用户意见 4） | 镜像在 `session_compact` 后把项目级新条目同步进全局镜像 + 标记来源项目 |

**不注册自己的 session_before_compact 钩子**（避免与 obs/chendpoc 竞争压缩），只监听 `session_compact` 做镜像同步。

### 6.3 双库设计（用户意见 4）

```
项目级：.pi/agent-mft/mirror.sqlite   （当前项目的记忆索引）
全局：  ~/.pi/agent/agent-mft/mirror.sqlite（跨项目记忆）
规则：
  - 查询合并（项目级优先加权，全局兜底）
  - 压缩/会话结束时：项目级新条目 → 同步进全局（去重后）
  - /mft 浏览器可切换 scope: project|global|all
```

### 6.4 敏感信息（用户意见 6）

- 镜像同步前跑脱敏过滤（API key/Bearer/私钥/.env 模式，规则复用 chendpoc redaction 的思路）
- 记忆地图注入时对含敏感标记的条目只显示地址不显示内容

---

## 7. 工具与命令面

| 工具（Agent 可调用） | 说明 |
|---|---|
| `mem_query {expr, limit?}` | 统一寻址查询（跨后端），返回记录列表 |
| `mem_get {addr}` | 地址展开（元数据 + 后端原文） |
| `mem_supersede {old_addr, new_addr}` | 建立取代链 |
| `mem_addr {backend_key}` | 为后端条目分配/查询确定性地址 |

| 命令（用户） | 说明 |
|---|---|
| `/mft <expr>` | 记忆浏览器：过滤/排序/展开 |
| `/mft:scope project|global|all` | 切换查询范围 |
| `/mft:inject` | 手动注入记忆地图 |
| `/mft:rebuild` | 重建镜像（扫描各后端） |
| `/mft:stats` | 各后端条目数/地址数/最近活动 |

---

## 8. 数据模型（mirror.sqlite，node:sqlite 零依赖）

```sql
CREATE TABLE IF NOT EXISTS mirror (
  addr       TEXT PRIMARY KEY,          -- 确定性地址 A1F3
  backend    TEXT NOT NULL,             -- obs | chendpoc | manual
  backend_key TEXT NOT NULL,            -- 后端原始键（ledger 条目 id / MEMORY.md 行定位）
  filename   TEXT NOT NULL,             -- 规范化一行描述（寻址主键）
  kind       TEXT,                      -- decision|fact|preference|task_state|entity_rel|commit|note
  entity     TEXT,
  path       TEXT,
  project    TEXT,                      -- 归一化 cwd
  ts         TEXT,
  importance REAL DEFAULT 0.5,
  status     TEXT DEFAULT 'active',     -- active|superseded|revoked
  supersedes TEXT,
  src        TEXT,                      -- 后端定位串（供 get 展开）
  meta       TEXT,                      -- 附加 JSON（敏感标记等）
  synced_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_mirror_kind ON mirror(kind);
CREATE INDEX IF NOT EXISTS idx_mirror_entity ON mirror(entity);
CREATE INDEX IF NOT EXISTS idx_mirror_project ON mirror(project);
CREATE INDEX IF NOT EXISTS idx_mirror_backend ON mirror(backend);
```

---

## 9. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M1 寻址引擎** | query.ts（语法解析→Filter）+ 单测 + CLI 验证 | 语法全过单测；`/mft:stats` 可跑 |
| **M2 适配器 + 镜像** | chendpoc 适配器 + mirror 表 + rebuild + mem_query/mem_get 工具 | 能寻址 chendpoc 的 MEMORY.md 条目；rebuild 幂等 |
| **M3 闭环** | 首轮评估注入 + /mft 浏览器 + addr/supersede + 双库同步 | 实测"记忆入库 → /mft 过滤查到 → 新会话首轮评估注入" |
| **M4 扩展** | obs 适配器 + 敏感过滤 + 记忆地图 TUI 渲染 + 全局索引（可选） | 双后端统一寻址 |

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| 依赖外部扩展（obs/chendpoc）可能变更/停更 | 适配器隔离 + npm 损坏时用 git 安装；镜像快照提供降级路径 |
| chendpoc 条目无元数据（时间/实体） | 镜像补充（首见时间、来源会话、规则提取实体） |
| 首轮评估子 Agent 增加延迟 | 便宜模型 + 预算限制 + `inject:"ask"`/`"off"` 可配 |
| 镜像与后端不一致 | `/mft:rebuild` 幂等重建；后端为真相、镜像可丢弃 |
| 记忆地图 token 开销 | 注入 ≤ top-10、每行 <30 token、无正文 |

## 11. 一句话

> **Agent MFT 是 pi 的"Everything"：不造记忆，只造寻址——用 Everything 语法 + 确定性地址 + 跨会话可重建镜像，让散落在各记忆后端（obs 的 ledger、chendpoc 的 Markdown）里的事实，第一次可以被精确、可引用、可追溯地寻址。**
