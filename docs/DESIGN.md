# Harness 设计文档：记忆优先的精品 Agent 客户端

> 版本：v0.1（设计稿） ｜ 日期：2026-08-01
> 定位：面向**开发者**的 Windows 桌面记忆优先 Agent harness（Electron + TypeScript）
> 核心主张：**记忆是内核，聊天是壳。** 差异化不在"模型抽取"，而在记忆的**寻址 / 存储 / 调用**三轴工程架构。

---

## 0. 设计缘起与原则

### 0.1 为什么放弃"挂载件 + MCP"路线

| 放弃的路线 | 原因 |
|---|---|
| 本地小模型增量抽取 | 总结效率受模型能力局限；小模型抽取质量上不去 |
| API 式抽取（mem0/MemOS/zep 生态位） | 已存在成熟生态位，无差异化 |
| MCP 挂载件 | 钩子受限（无法拦截宿主压缩/注入），记忆沦为可选附件 |

### 0.2 为什么记忆是内核而非附件

挂载件需要"读别人的 session JSONL"（memU 的做法，笨拙且滞后）。**harness 自己就是事件源**：工具调用、文件变更、决策节点全部内建可达。事件流自产意味着"日志即真相源"无需任何适配层——这是做 harness 相对挂载件的**结构性红利**。

### 0.3 三轴架构（本设计的心脏）

```
轴 1 记忆寻址（Addressing）—— 如何精确、快速、确定性地找到一条记忆
轴 2 记忆存储（Storage）  —— 日志真相 + 投影索引 + 可逆压缩
轴 3 记忆调用（Invocation）—— 何时注入、注入什么、如何展开
```

一切与"模型能力"相关的部分（谁负责把会话变成结构化记录）**刻意保持简单**：交给主 Agent 通过内核协议完成。模型会过时，架构不会。

---

## 1. 系统架构总览

```
┌──────────────────────────────────────────────────────────────┐
│ 渲染进程 (React)                                              │
│  ├─ 对话界面（极简壳：输入/输出/记忆地图侧栏）                  │
│  ├─ 记忆浏览器（Everything 式窗口：过滤/排序/展开原文）          │
│  └─ 记忆关系视图（supersede 链，v2）                           │
├──────────────────────────────────────────────────────────────┤
│ 主进程 (Electron Main)                                        │
│  ├─ 窗口与生命周期                                             │
│  ├─ LLM 网关（OpenAI 兼容：OpenRouter/DeepSeek/本地 Ollama）    │
│  ├─ 记忆注入管线（会话开启时寻址注入 / 压缩时归档）              │
│  └─ 内核 IPC 桥（渲染进程 ↔ 记忆内核）                          │
├──────────────────────────────────────────────────────────────┤
│ 记忆内核 (Node worker，独立进程)                               │
│  ├─ 事件日志引擎（不可变 append-only + USN 游标）               │
│  ├─ MFT 投影引擎（SQLite，可重建）                              │
│  ├─ 寻址引擎（过滤语法解析 + 多维度排序）                        │
│  ├─ 压缩归档器（线程 → 记忆记录，可逆）                          │
│  └─ 重建器（从日志重放投影）                                    │
├──────────────────────────────────────────────────────────────┤
│ 存储层                                                         │
│  ├─ SQLite (WAL, better-sqlite3)：event_log + mft + meta       │
│  └─ 原文快照文件（按需落盘，日志惰性展开用）                     │
└──────────────────────────────────────────────────────────────┘
```

**进程隔离理由**：记忆内核独立于 UI 生命周期——聊天窗口崩了记忆不丢；内核崩溃投影可重建，日志不受影响。

---

## 2. 轴 1：记忆寻址（Addressing）

### 2.1 五层寻址机制

| 机制 | 语法示例 | 本质 |
|---|---|---|
| 确定性寻址 | `#A1F3` | 稳定地址，跨会话引用；Agent 可以说"看 #A1F3 那条决策" |
| 游标寻址 | `seq:>1024` / 内部 | 单调递增 USN 序号，增量同步与全局缓存的引擎 |
| 过滤寻址 | `type:decision entity:auth since:2w` | Everything 式多维过滤，纯结构化命中，毫秒级 |
| 路径寻址 | `path:projA/arch` | 层级命名空间，类比文件系统目录 |
| 语义兜底 | 过滤后候选集 < 50 条时 | 向量排序辅助，**embedding 是配角不是主角** |

### 2.2 寻址语法（Everything 风格，v1 子集）

```
<expr>    := <term> ( <space> <term> )*
<term>    := <keyword>          # 全文关键词（filename 子串匹配）
           | 'type:' kind       # decision|fact|task_state|preference|entity_rel|commit
           | 'entity:' name     # 实体（归一化后）
           | 'path:' a/b        # 层级路径（前缀匹配）
           | 'since:' duration  # 1h|1d|2w|3m|1y
           | 'imp:>0.7'         # 重要性过滤（>、<、>=、<=）
           | 'status:active'    # active|superseded|revoked
           | '#A1F3'            # 确定性地址
组合示例：
  type:decision entity:auth since:2w imp:>0.6
  path:projA/arch status:active
```

关键词匹配沿用 Everything 的"文件名子串匹配"语义——**搜索的是 `filename`（规范化一行描述），不是全文**。全文只通过展开（`mem.get`）到达。

### 2.3 确定性地址编码

- 短码：`A1F3` 式（Base36，自增 + 混淆），一条记忆一个稳定地址，**永不重用**
- 地址即引用：记录可被 agent 引用、被 supersede 链挂载、被注入时引用
- 地址由内核生成并持久化于 `mft.addr`（重放重建时保持一致：`addr = encode(seq)`）

---

## 3. 轴 2：记忆存储（Storage）

### 3.1 双轨制：日志是真相，投影是缓存

```
event_log（不可变，append-only）     ← 真相源：一切事件的原始记录
      │ 重放（rebuild）
      ▼
mft 投影（可变，SQLite 索引）         ← 缓存：可随时丢弃、重建
```

- 写入路径：事件 → event_log（原子落盘）→ 投影更新（同事务或异步）
- **重建路径**：`rebuild()` = 从 event_log 按序重放，重构 mft 投影——对应 Everything 的 Rescan
- 投影与日志不一致时，以日志为准（审计、修复、版本升级的底气）

### 3.2 压缩即归档（可逆压缩）

上下文压缩**不是"总结"**，而是三段式归档：

```
1. 触发：上下文用量 > 阈值（如 85%）
2. 归档：Agent 按内核协议将本线程值得记忆的内容 mem.add 写入投影；
          系统同时把线程关键事件留在 event_log（天然完整）
3. 裁剪：上下文收缩为 [记忆地图（寻址结果） + 最近 N 轮]
```

可逆性：任何被裁剪的原始内容都仍在 event_log 中，`mem.get` / 手动回溯可还原线程。**压缩从"有损操作"变成"无损归档 + 索引化"。**

### 3.3 记忆生命周期

```
            mem.add            决策被推翻
   ──────────────► active ──────────────► superseded
                        \                 
                         └────► revoked（用户显式删除/错误记录）
```

- `supersedes` 字段挂接取代链：`#A1F3 ──取代──► #B7C2`，关系视图可追溯决策演变
- 时效窗口（v2）：可选 `valid_until`，过期自动降权

### 3.4 惰性物化

- `mft` 只存**地址 + 元数据 + src_seq 指针**，不含正文
- 正文在 event_log / 原文快照中，`mem.get` 时按 `src_seq` 惰性展开
- 存储开销 ≈ 元数据行大小，百万条记忆也在百 MB 级以内

---

## 4. 轴 3：记忆调用（Invocation）

### 4.1 会话开启：注入管线

```
开启新会话
  → 读取上下文（项目路径/当前任务/用户指定）
  → mem.query（自动构造：相关 path + imp:>0.4 + 最近时间窗，限 top-15）
  → 生成"记忆地图"注入 system prompt（紧凑格式，见 4.4）
  → 对话开始；Agent 需要细节时主动 mem.get 展开
```

### 4.2 压缩时：自动归档

- 压缩钩子内建（非外挂）：阈值触发 → 提示 Agent 归档 → 裁剪上下文
- 若 Agent 未响应归档提示，系统从 event_log 提取本线程工具调用与决策信号做**最小化兜底记录**（只记 filename+kind+entity，不生成正文——规避模型质量依赖）

### 4.3 按需展开

- `mem.get #A1F3` → 返回元数据 + 从日志惰性展开的正文
- 注入时只给"文件名"（一行描述），正文按需取——**信息密度最大化，token 消耗最小化**

### 4.4 记忆地图格式（注入模板 v1）

```
## Memory Map（记忆地图，会话开始时注入）
以下为本会话相关记忆（地址/类型/描述）。需要细节时用 mem.get <addr> 展开。

#A1F3 [decision] 采用 SQLite WAL 作为存储层（entity: storage, path: projX/arch, 2w 前, imp 0.9）
#B7C2 [fact] 用户偏好 Tauri 体积 < 10MB（entity: user, 3d 前, imp 0.7）
...
```

### 4.5 内核工具协议（Agent 可见，v1）

| 工具 | 说明 |
|---|---|
| `mem.add {filename, kind, entity?, entity2?, path?, importance?}` | 写入记录，返回地址 |
| `mem.query {expr, limit?}` | 寻址查询，返回记录列表 |
| `mem.get {addr}` | 展开：元数据 + 日志正文 |
| `mem.supersede {addr}` | 标记旧记录被取代 |
| `mem.revoke {addr}` | 撤销/删除记录 |

---

## 5. 数据模型（SQLite DDL）

```sql
-- 事件日志：真相源，不可变，仅 INSERT
CREATE TABLE event_log (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,  -- USN 语义游标
  ts         TEXT NOT NULL,                       -- ISO8601 UTC
  session_id TEXT NOT NULL,
  kind       TEXT NOT NULL,   -- user_msg|agent_msg|tool_call|tool_result|mem_add|decision|file_change|...
  payload    TEXT NOT NULL,   -- JSON 原文（不可变）
  digest     TEXT             -- SHA-256 摘要（可选防篡改）
);

-- MFT 投影：可重建（SELECT * FROM event_log 按序重放）
CREATE TABLE mft (
  addr       TEXT PRIMARY KEY,       -- 确定性地址（encode(seq)）
  filename   TEXT NOT NULL,          -- 规范化一行描述（Everything 的"文件名"，寻址主键）
  kind       TEXT NOT NULL,          -- decision|fact|task_state|preference|entity_rel|commit
  entity     TEXT,                   -- 主实体（归一化小写）
  entity2    TEXT,                   -- 关联实体
  path       TEXT,                   -- 层级路径 projA/arch
  ts         TEXT NOT NULL,
  importance REAL DEFAULT 0.5,       -- 0~1
  status     TEXT DEFAULT 'active',  -- active|superseded|revoked
  supersedes TEXT,                   -- 被取代的旧地址
  src_seq    INTEGER NOT NULL,       -- 内容指针 → event_log.seq
  meta       TEXT                    -- 附加 JSON（可选）
);

CREATE INDEX idx_mft_kind   ON mft(kind);
CREATE INDEX idx_mft_entity ON mft(entity);
CREATE INDEX idx_mft_path   ON mft(path);
CREATE INDEX idx_mft_ts     ON mft(ts);
CREATE INDEX idx_mft_status ON mft(status);
```

---

## 6. GUI：记忆浏览器（Everything 式窗口）

```
┌─────────────────────────────────────────────────────────┐
│ 🔍 type:decision entity:auth since:2w        [7 条结果] │  ← 寻址输入框（即时过滤）
├──────┬──────────────────────────┬──────┬────────┬───────┤
│ 地址 │ 文件名                    │ 类型 │ 时间   │ 重要  │
├──────┼──────────────────────────┼──────┼────────┼───────┤
│ A1F3 │ 采用 SQLite WAL 存储层    │ dec  │ 2w 前  │ 0.9   │
│ B7C2 │ 用户偏好 Tauri <10MB      │ fact │ 3d 前  │ 0.7   │
│ ...  │                           │      │        │       │
└──────┴──────────────────────────┴──────┴────────┴───────┘
   点击行 → 展开原文（日志惰性加载）| 右键 → 取代/撤销/复制地址
   v2：supersede 链关系视图、时间轴视图
```

- 渲染进程查询走 IPC → 内核寻址引擎 → SQLite（毫秒级）
- 这是产品的"门面"：Everything 用窗口证明了索引价值，记忆浏览器同理

---

## 7. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面壳 | Electron + React + TypeScript | 生态成熟、开发效率高（已定） |
| 数据库 | better-sqlite3（WAL 模式） | 同步 API 简单可靠、单文件、事务 |
| LLM 网关 | OpenAI 兼容 API（OpenRouter/DeepSeek/Ollama） | 一套协议全兼容 |
| UI | Tailwind CSS（shadcn 风格） | 精品观感、快 |
| 状态 | zustand | 轻量 |
| 测试 | vitest（内核单测）+ Playwright（GUI，v2） | |

---

## 8. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M1 记忆内核** | event_log + mft + 寻址引擎 + 压缩归档器 + 重建器（Node 模块 + CLI + 单测） | 寻址语法全过单测；重建一致性验证；百万行日志 < 1s 查询 |
| **M2 最小闭环** | Electron 壳 + LLM 网关 + 开启注入 + 压缩归档 + 记忆浏览器 v1 | 跑通"开启注入 → 对话 → 压缩归档 → 再寻址"全链路 |
| **M3 精品打磨** | 记忆关系视图、时间轴、导出/导入、多会话/项目管理、记忆地图侧栏 | 开发者日活使用无摩擦 |
| **M4 扩展（可选）** | 全局索引（捕获其他应用事件）、Everything 式系统级寻址 | — |

## 9. 面向开发者的差异化卖点（对外叙事）

1. **记忆寻址语言**：Everything 语法移植到 Agent 记忆——可脚本化、可编程、可组合
2. **压缩可逆**：上下文压缩不再丢信息，任何裁剪都可从日志还原
3. **投影可重建**：索引损坏/升级 = 重放日志，永不重建记忆成本
4. **记忆即内核**：不是 MCP 外挂，记忆是 harness 的一等公民

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| 记忆写入依赖 Agent 主动调用 mem.add | 压缩钩子兜底提取 + 会话结束归档提示；协议提示注入 system prompt |
| 无向量主检索，语义召回弱 | 定位就是"结构化寻址优先"；语义兜底 v2 再加（embedding 本地化） |
| 精品型 harness 功能面窄 | 面向开发者细分市场，不做大而全；记忆内核协议开放（未来可导出） |
| Electron 内存占用 | 内核独立进程 + SQLite WAL + 惰性加载；记忆浏览器虚拟滚动 |
