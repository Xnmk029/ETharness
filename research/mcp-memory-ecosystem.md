# MCP 记忆生态调研报告（2026-08）

> 目的：评估"Agent MFT"（日志为真相源 + 极小模型增量抽取 + 原子化可过滤索引 + 可重建投影 + Windows 原生薄壳）在现有生态中的差异化空间。
> 数据来源：GitHub API + 各项目 README + HF 模型卡 + DeepSeek API 文档（原始数据存于 `research/data/`）。
> 配套文档：`model-selection-v4flash.md`（DeepSeek-V4-Flash-0731 选型评估）。

---

## 一、生态全景（按定位分四类）

### A. 通用记忆层（Agent-agnostic，挂载件形态）

| 项目 | Stars | 语言 | 存储 | 抽取/写入方式 | 集成方式 | Windows |
|---|---|---|---|---|---|---|
| **mem0** | 62k | Python | 自研向量库 + 图 | **云 LLM 抽取**（API 调用） | SDK / MCP / API | ✅ |
| **MemPalace** | 58k | Python | ChromaDB + SQLite 知识图谱 | **零抽取**：逐字原文 + 语义检索，可插拔后端 | MCP（36 工具）/ CLI / hooks | ✅ |
| **memU** | 14k | Python | SQLite + 向量（可换 PG） | **宿主 Agent 自己蒸馏**（MemoryService 零 LLM 调用） | 各宿主 adapter / CLI | ✅（Codex、Claude Code、Cursor、WorkBuddy…） |
| **EverOS** | 12k | Python | Markdown（真相）+ SQLite + LanceDB | 主模型抽取（OpenRouter/DeepInfra） | REST / 库 / 插件生态（Raven、EverMe、evermemos-mcp） | ✅ |
| **MemOS** | 10.5k | TS | 自托管 Neo4j+Qdrant / 本地 SQLite+FTS5+向量 | 云 LLM 抽取（插件模式由宿主插件触发） | REST / OpenClaw & Hermes 插件 | ✅（PowerShell 安装） |
| **engram** | 5.8k | Go | SQLite + FTS5 | **宿主 Agent 主动写入**结构化记忆（mem_save） | MCP stdio / CLI / HTTP / TUI | ✅（单二进制） |
| **zep** | 4.8k | Python | Graphiti 时间知识图谱 | 云 LLM 抽取 | MCP / SDK | ✅ |
| **basic-memory** | 3.5k | Python | Markdown 文件 + 图 | 主模型 | MCP | ✅ |

### B. 上下文优化（压缩侧）

| 项目 | Stars | 说明 |
|---|---|---|
| **context-mode** | 19.5k | 工具输出沙箱化，号称压缩 98% 上下文 token——**与"压缩"环节直接竞争，但只做压缩不做记忆** |

### C. Harness 形态（含记忆）

| 项目 | Stars | 说明 |
|---|---|---|
| **ECC** | 237k | Agent harness 性能优化系统（skills/instincts/memory/security），插件横跨 7 个 harness，Pro 是 SaaS |
| **osaurus** | 7.4k | macOS 原生 harness + 持久记忆——**macOS only，Windows 空白** |
| **Letta** | 24k | 自编辑记忆块的状态化 Agent 平台（服务端 + Web/TUI） |

### D. 记忆基准

| 项目 | 基准成绩 |
|---|---|
| **MemPalace** | LongMemEval R@5：raw 96.6%（零 LLM）、hybrid v4 98.4%、+rerank ≥99%；LoCoMo R@10 88.9% |
| **MemOS** | LoCoMo 88.83 / LongMemEval 89.20 / OmniMemEval 第一梯队 |

---

## 二、五个关键共性模式（重要发现）

1. **挂载件是绝对主流**：A 类全部是 MCP/CLI/插件/SDK 形态，没有一个做"完整 GUI harness"——验证了上一轮"做挂载件"的战略判断，生态已经证明这条路走得通。
2. **抽取方式只有三种，没有"极小模型"路线**：
   - 云 LLM 抽取（mem0、MemOS、zep、EverOS）——有 API 成本、依赖网络
   - 宿主 Agent 自己写（memU、engram）——质量好但占用主模型 token，且依赖 Agent 配合
   - 完全不抽取（MemPalace）——原文 + 向量，最省但无结构化层
   - **无人使用 0.5B~2B 本地小模型做增量抽取**——这是全生态空白。
3. **"日志即真相源"已有人接近**：memU 的 host adapter 直接读各 Agent 的 session JSONL（≈USN Journal）；MemPalace 的 hooks 在压缩前保存原文快照；engram 有 session lifecycle + compaction survival。**但没有人把"日志→投影→可重建"当作一等架构原则。**
4. **Everything 式查询语法不存在**：engram 有 topic keys、EverOS 有多维检索（user/agent/app/project/session），但**没有产品化的过滤语法**（`type:` / `entity:` / `since:` / `importance:`）。只有 MemPalace 的 wings/rooms/drawers 有"作用域检索"的影子。
5. **Windows 原生薄壳空白**：osaurus 是 macOS-only；ECC/engram/memU 都是 CLI/MCP；MemOS 有 Windows 插件但无 GUI。**"Windows 桌面 GUI + 记忆优先"没有对标物。**

---

## 三、与"Agent MFT"构思的逐项对照

| Agent MFT 要素 | 最接近者 | 差距 |
|---|---|---|
| 事件日志为真相源 | memU（读 session JSONL）、MemPalace（原文快照） | 无人声明"日志唯一真相、索引可重建"原则 |
| **极小模型增量抽取** | 无 | **全生态空白，最大差异化点** |
| 原子化元数据 + 多维过滤 | EverOS（正交维度）、MemPalace（wings/rooms/drawers） | 无过滤语法、无原子化记录设计 |
| 压缩=存档 | engram（session lifecycle）、MemPalace（压缩前 hooks） | 无人把"压缩归档 + 开启注入"做成产品闭环 |
| 可重建投影 | 无 | 空白 |
| Windows 原生 GUI 薄壳 | osaurus（仅 macOS） | 空白 |

## 四、结论：差异化空间确认

**拥挤区（不要正面竞争）**：向量存储、SQLite、Markdown 真相、知识图谱、MCP 工具面、基础检索——全是标配。

**空白区（你的定位）**：

1. 🥇 **极小模型增量抽取管线**（零 API 成本、离线、隐私、毫秒级）——没有任何人做
2. 🥈 **MFT 式原子化记忆 + Everything 查询语法**——产品化后是强认知记忆点
3. 🥉 **日志→投影→可重建的工程纪律**——memU/MemPalace 有雏形但未成原则
4. 🏅 **Windows 原生薄壳 + 记忆优先体验**——osusaurus 在 macOS 验证了需求，Windows 侧无人

**必须面对的基准线**：MemPalace（LongMemEval 96.6% raw）和 MemOS（LoCoMo 88.83）已经把"无 LLM/低 LLM 检索"的分数抬得很高。Agent MFT 的小模型抽取路线需要在**结构化记忆质量**（而非纯检索召回）上定义自己的评估维度——比如"决策恢复准确率""跨会话一致性"，避免在向量召回上与 MemPalace 正面对标。

## 五、落地建议

```
保留：Core Service（SQLite 日志 + MFT 表）+ MCP Server + 薄参考客户端
新增约束：
  1. 抽取管线采用双引擎分层（见第六节）：L1 本地小模型增量 + L2 V4-Flash 批量再蒸馏
  2. 查询语法从第一天就是产品特性（type:/entity:/since:/importance:）
  3. 先做 benchmarks 基础设施（LongMemEval 子集 + 自建决策恢复测试），
     否则无法与 MemPalace/MemOS 的数字竞争
  4. 集成策略向 memU 学习：读各 Agent 的 session JSONL（pi/Claude Code/Cherry Studio）
     ——这就是"USN Journal"，比让 Agent 主动调用记忆工具更可靠
  5. 薄壳客户端对标 osaurus 的 macOS 定位，做 Windows 版
```

## 六、模型选型结论：双引擎分层架构（2026-08-01 定稿）

> 详细评估见 `model-selection-v4flash.md`。结论：**V4-Flash-0731 是"深度记忆蒸馏器"（L2），不是"常驻增量处理器"（L1）**。

```
L0 规则层（正则/启发式，免费）                    ← 时间/类型/实体初步提取
L1 本地真·小模型（1~3B）逐事件增量抽取             ← USN Journal 处理器
   角色：快、免费、离线、隐私；全生态空白 = 差异化护城河
L2 DeepSeek-V4-Flash-0731（API 优先）             ← 批量再蒸馏引擎 ★
   角色：定期重抽取（compaction）、实体归一、冲突判定（superseded）、
         压缩时深度归档、L1 记录质量审计
```

**为什么 V4-Flash 进 L2 而非 L1**：

- 284B 总权重（13B 激活）：llama.cpp 2bit 量化仍需 128GB 内存，官方路径需 4×GB300 / 2×DGX Spark——普通 Windows 机器无法常驻
- 走 API 做全部抽取 = 沦为 mem0/MemOS/zep 同款"云 LLM 抽取"，放弃本地优先差异化
- 0731 版 agentic 能力暴涨（Terminal Bench 2.1：82.7，超 V4-Pro preview 72.1）+ 1M 上下文 + JSON 输出 + MIT 开源——作为批处理引擎性价比最佳

**成本结构**：L1 免费无限量；L2 仅在压缩/定期/审计时按批调用，13B 激活的低价档使总开销可忽略。

## 七、研究文件清单

```
research/
├── mcp-memory-ecosystem.md        # 本报告（生态全景 + 差异化 + 双引擎架构）
├── model-selection-v4flash.md     # V4-Flash-0731 选型评估（规格/评估/注意点）
└── data/                          # 原始数据（GitHub API JSON、各项目 README、HF 模型卡）
```
