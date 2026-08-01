# pi 记忆扩展源码拆解报告（2026-08-01）

> 对象：`pi-observational-memory` v3.0.3（GitHub master）与 `@chendpoc/pi-memory` v0.3.2（GitHub main）
> 方法：npm tarball + GitHub 源码下载，核心模块精读
> 源码位置：`research/src/obs-gh/`、`research/src/chendpoc-gh/`
> **重要发现：两个包的 npm 发布均不完整**（obs 缺 hooks/commands/tools/session-ledger 目录；chendpoc 的 dist 缺大量模块）——安装应使用 `pi install git:github.com/...` 而非 npm。

---

## 一、pi-observational-memory V3：会话内记忆的教科书实现

### 1.1 设计哲学（ledger-centered）

**记忆状态 = 分支上 V3 ledger 条目的 fold（折叠）投影**。不维护可变状态，一切从 ledger 重建——这正是我们"日志=真相、投影可重建"纪律的现成实现，且做到了极致。

### 1.2 组件图

```
turn_end ──► Observer（token 时钟 ≥ observeAfterTokens）
        │     └─ 后台模型调用 → append om.observations.recorded（coversUpToId 水位）
        └─► Reflector（≥ reflectAfterTokens）
              └─ 模型蒸馏持久事实 → om.reflections.recorded（引用观察 ID）
              └─ Dropper（池超预算）→ om.observations.dropped（墓碑，不删历史）
agent_end ──► 压缩触发（≥ compactAfterTokens 且 idle）→ ctx.compact()
session_before_compact ──► fold ledger → 确定性渲染 summary（零模型！）→ om.folded details
recall 工具 ──► 12 字符 ID → 溯源 sourceEntryIds（证据回放）
/om:status / /om:view ──► full/visible/diff 四种投影
```

### 1.3 关键机制

| 机制 | 实现 | 与我们设计的对应 |
|---|---|---|
| ledger 条目 | `om.observations.recorded` / `om.reflections.recorded` / `om.observations.dropped`，全部走 pi `appendEntry` 进 session | 事件日志 |
| **水位标记** | 每条 `coversUpToId`——进度/投影水印 | **我们的 USN 游标** |
| **fold 投影** | 从分支根 fold 到边界，按水位定位条目（非物理位置） | **我们的重建器（rebuild）** |
| 确定性压缩 | 压缩钩子只做 fold+render，**零模型、零等待** | 我们的"压缩即归档"（但比我们更彻底） |
| 证据溯源 | recall 工具按 ID 回放源条目 | 我们的 `src_ref` 惰性展开 |
| 后台 worker | observer/reflector/dropper 在 turn_end 后台跑，绝不阻塞压缩 | 我们的"压缩钩子兜底" |

### 1.4 优点与局限

**优点**：架构极干净（~100KB 源码）、24 个测试文件覆盖（含 fold/projection/recall 专项测试）、不变量明确（"ledger 是真相、压缩确定性、水位非溯源"）、后台记忆不阻塞交互。

**局限（关键）**：
1. **会话内记忆**——ledger 在分支内，不做跨会话（README 定位"keep long sessions coherent"，与我们的"全局缓存"是不同赛道）
2. **查询能力弱**——只有 recall（按 ID 溯源），**无任何过滤/搜索语法**
3. **npm 发布损坏**（tarball 缺核心目录）——需 git 安装
4. 观察/反思依赖后台模型调用（默认用会话模型，可配便宜模型）

---

## 二、@chendpoc/pi-memory：跨会话记忆的完整实现

### 2.1 设计哲学

**MEMORY.md 为真相（人类可审计/可编辑）+ sidecar 索引为检索 + preflight 注入为调用**。跨会话、本地、Markdown 优先。

### 2.2 组件图

```
session_start ──► MemoryRuntime.bootstrap
                  ├─ MemoryStore（MEMORY.md + auto-*.md，150 行上限+溢出）
                  ├─ sidecar 进程（episodic 会话/向量索引，socket IPC）
                  ├─ consolidate 调度器（后台 LLM 合并去重）
                  └─ 加载 sessionMemoryCap（记忆顶）
before_agent_start ──► runEpisodicPreflight(prompt)
                  ├─ 意图分析（LLM 辅助模型，--memory-helper-model）
                  ├─ episodic 检索（sidecar 向量/会话）
                  └─ merge → privateContext
context 事件 ──► 把记忆上下文直接改写进最后一条 user message 文本
session_before_compact ──► 双用途摘要（一次 LLM 调用：pi 摘要 + ## Memory Export 区块）
session_compact ──► 解析 Memory Export → 写入 MEMORY.md（appendFromCompaction）
session_shutdown ──► 短会话排空队列（drain）
/remember /memory-status ──► 用户显式记录/状态
```

### 2.3 关键机制

| 机制 | 实现 | 评价 |
|---|---|---|
| 双用途压缩 | 压缩时 LLM 一次调用产出 `{summary + ## Memory Export(Preferences/Conventions/Findings/Todos)}`，session_compact 后解析入库 | **"压缩后 LLM 复盘入库"的现成实现** |
| 注入方式 | `context` 事件改写 user message 文本（非独立 message） | 与我们的 message 注入不同——更隐蔽但可读性差 |
| preflight 管线 | 每轮前：意图分析 + episodic 检索 + 预算控制（budgetMs） | 每轮都有 LLM 辅助调用（成本可控） |
| 脱敏 | redaction 模块（API key/Bearer/私钥/.env） | 已解决我们风险清单里的"敏感信息"项 |
| 子代理感知 | subagent 用小视图 + 去重写入 | 细节打磨到位 |
| Windows | schtasks 计划任务模板 + 平台抽象 | Windows 一等公民 |
| 维护 | consolidate 后台合并去重、shutdown 队列排空 | 完整 |

### 2.4 优点与局限

**优点**：功能完整（~200KB + 40+ 测试）、Markdown 真相可审计、脱敏、子代理感知、Windows 支持、双用途压缩一次调用双产出、中文文档。

**局限**：
1. **查询=检索而非寻址**——向量+意图检索，**无 Everything 式过滤语法、无确定性地址**
2. 架构较重（sidecar 进程 + LLM 辅助模型 + 向量索引）
3. npm 发布同样损坏（dist 缺模块）
4. 注入靠改写 user message，与 pi 的 message 注入相比侵入性更强

---

## 三、两者对照

| 维度 | pi-observational-memory | @chendpoc/pi-memory |
|---|---|---|
| 记忆范围 | **会话内**（ledger 在分支） | **跨会话**（全局 MEMORY.md） |
| 真相源 | session ledger 条目 | Markdown 文件 |
| 压缩 | 确定性 fold+render（零模型） | 双用途摘要（一次 LLM 调用） |
| 写入 | 后台 observer/reflector 模型调用 | /remember + 压缩导出 + shutdown 排空 |
| 注入 | 压缩摘要（agent 可见） | 每轮 preflight 改写 user message |
| 查询 | recall（按 ID 溯源） | 向量+意图检索 |
| **过滤语法** | ❌ | ❌ |
| **确定性地址** | ⚠️ 12 字符 ID（仅溯源用） | ❌ |
| 重建纪律 | ✅ fold 投影（会话内） | ⚠️ 无（文件即真相） |
| 代码质量 | 极简干净，测试全 | 完整工程化，测试全 |
| npm 发布 | ❌ 损坏 | ❌ 损坏 |
| 可 fork 性 | 高（100KB，设计文档齐全） | 中（200KB，依赖 sidecar/向量较重） |

---

## 四、对我们的意义（战略结论）

### 4.1 我们设计的各环节已被覆盖

| 我们的设计 | 已被谁实现 |
|---|---|
| 压缩即归档 | obs（确定性版）+ chendpoc（LLM 复盘版） |
| 跨会话记忆+注入 | chendpoc（完整） |
| 密钥脱敏 | chendpoc |
| 后台记忆不阻塞 | obs（worker 不阻塞压缩） |
| 日志→投影纪律 | obs（fold，但限会话内） |
| 压缩后 LLM 复盘入库（用户新要求） | chendpoc 双用途摘要（最接近） |

### 4.2 依然空白的点（真正的差异化）

1. **Everything 式过滤语法**（`type:`/`entity:`/`since:`/`imp:`/`#addr`）——两者都没有
2. **确定性地址引用语言**（`#A1F3` 跨会话引用、supersede 链）——obs 的 ID 仅做溯源，不做引用/关系
3. **跨会话可重建投影**——obs 的 ledger 纪律 × chendpoc 的跨会话范围，这个组合无人做
4. **记忆浏览器**（Everything 式 GUI/命令）——只有 /om:status / /om:view / /memory-status，无过滤浏览

### 4.3 fork 可行性评估（路线 B 落点）

| 选项 | 评估 |
|---|---|
| fork obs 扩展到跨会话 | 大工程：ledger 从分支扩展到全局需重设计 coversUpToId 语义、多会话水位 |
| fork chendpoc 加寻址层 | 中等：它的存储是 Markdown 行条目，可在 store 层加 addr/kind/entity 字段 + 查询引擎；双用途摘要天然产结构化区块 |
| **独立薄层（寻址语言）** | 最小：不碰存储，只做语法解析 + 统一查询接口，挂接任一后端（obs 的 ledger / chendpoc 的 Markdown / 自建 SQLite 镜像） |

### 4.4 推荐路径（更新）

1. **装 GitHub 版实测**（npm 包损坏，用 `pi install git:...`）：
   - `pi install git:github.com/elpapi42/pi-observational-memory`（长会话压缩体验）
   - `pi install git:github.com/chendpoc/pi-memory`（跨会话记忆体验）
2. 用 1~2 天实测后，评估：
   - 若两者已满足 80% 需求 → **只做"寻址语言薄层"**（路线 A），把 Everything 语法做成可挂任何后端的查询扩展
   - 若注入/压缩体验有硬伤 → fork chendpoc 加寻址层（路线 B）
3. 无论哪条路，**不要再自建存储/注入/压缩**——红海已充分验证，且实现质量超过我们从零做的水平
