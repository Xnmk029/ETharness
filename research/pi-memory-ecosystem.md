# Pi 记忆扩展生态调研报告（2026-08-01）

> 目的：在"以 pi 为基底搭建 Agent MFT"之前，调查 pi 生态已有的记忆扩展，评估差异化空间。
> 方法：npm registry 搜索（keywords:pi-package memory / 全量 pi-package）+ GitHub 搜索 + 10 个核心包的 README 深读。
> 原始数据：`research/data/npm_*.md`（各包 README）。

---

## 一、结论先行

1. **pi 记忆扩展是拥挤赛道**：npm 上发现 **30+ 个**记忆相关 pi 包，覆盖所有主流架构路线
2. **"压缩即归档"已被深度实现**：`pi-observational-memory`（v3）已实现后台观察+反思双层记忆、压缩时零模型调用、recall 溯源
3. **"跨会话记忆+注入"是标配**：几乎所有包都做会话前/回答前记忆注入
4. **我们三轴设计中的"寻址语言"仍是空白**：没有任何包提供 Everything 式过滤语法（`type:`/`entity:`/`since:`/`imp:`）与确定性地址引用
5. **结论：不应再自建完整记忆内核**——应选择"站在巨人肩上，只做空白点"或"深度定制最接近者"

---

## 二、生态全景（按架构路线分类）

### A. 观察式记忆（与"压缩即归档"最接近）

| 包 | 版本 | 核心机制 |
|---|---|---|
| **pi-observational-memory** | v3.0.3 | 观察（observations，时间戳事件）+ 反思（reflections，持久事实）双层；turn_end 后台 worker（token 时钟驱动 observe/reflect/dropper）；**压缩时零模型调用**（渲染已备好的记忆）；recall 工具按 12 字符 ID 溯源；主动压缩触发（token 阈值/比率模式）；配置丰富（模型覆盖、passive 模式）。灵感来自 Mastra Observational Memory |
| @sovorn/pi-observational-memory | v0.1.4 | 同思路独立实现：观察+反思+去冗余，压缩期间受限反思上下文 |

### B. 外部后端式（云/服务/共享）

| 包 | 后端 | 特点 |
|---|---|---|
| **gentle-engram** | Go 二进制 SQLite+FTS5（可云同步） | 事件捕获 + Memory Protocol 注入 + Pi 原生 mem_* 工具 + MCP 共享；压缩生存协议；`<private>` 块脱敏；TUI 浏览 |
| @pi-unipi/memory | MemPalace（自动安装）+ sqlite-vec 兜底 | 向量搜索 + Markdown 可编辑副本；项目级/全局双轨 |
| @loreai/pi | Lore 引擎（三阶存储） | 蒸馏/策展/梯度上下文管理；本地 embedding（nomic-embed，~137MB） |
| pi-everos-memory | EverOS | 模型可调用的用户记忆工具 |
| @amaster.ai/pi-memory-mem0 | Mem0 | 被动记忆，云/本地双模式 |
| @arvoretech/pi-memory | Qdrant + GitHub OAuth | 云 RAG |
| @eleboucher/pi-memini | memini | 跨会话共享 |

### C. Markdown 文件式（本地真相、可审计）

| 包 | 特点 |
|---|---|
| **@chendpoc/pi-memory**（v0.3.2） | **MEMORY.md 真相 + auto-*.md 溢出**；`/remember` 用户显式记录；压缩导出持久事实；**回答前自动召回注入**；**密钥/令牌脱敏**；150 行上限 + consolidate 去重；子代理感知（小作用域视图）；离线维护任务。中文文档 |
| pi-memory-md | Letta-like；git 版本化记忆；会话开始追加记忆索引；按需读全文；多项目 |
| @amaster.ai/pi-memory | MEMORY.md + USER.md 双文件 |
| pi-memory-extension / simple-pi-memory / @yandy0725/pi-memory | Markdown 变体 |
| @fractaal/pi-cross-agent-memory | 注入 Claude Code/Codex 的记忆索引（跨 agent） |

### D. 学习/提取式（LLM consolidation）

| 包 | 特点 |
|---|---|
| @samfp/pi-memory | 会话结束 LLM 合并；**纠正即教训**（"用 sed 别用 echo >>"）；注入新会话 system prompt；配套 pi-total-recall 全家桶 |
| open-zk-kb | corrections stick、context compounds |

### E. RAG / 本地检索式

| 包 | 特点 |
|---|---|
| @fingerskier/augment | 本地 RAG；huggingface transformers 本地 embedding；记忆即文件（Dropbox 同步）；跨 agent 插件（Claude/Codex/Grok/opencode） |
| pi-goosedump | **gpt-oss-20b 提取原子陈述 + bge-small 嵌入 + SQLite 溯源**；词法/实体优先、余弦兜底；压缩后学习；Windows x64 原生二进制 |
| abmind / openlore | SQLite+FTS5+嵌入四层记忆 / 架构记忆 |

### F. 其他

pi-hermes-memory（记忆+会话搜索+密钥扫描）、@remnic/plugin-pi、@zhafron/pi-memory、@ryan_nookpi/pi-extension-memory-layer、@getpipher/armory-memory、@asaki14/pi-memory（Cloudflare）、@danypops/papyrus（图工件）等。

---

## 三、与"Agent MFT 三轴"的逐项对照

| 我们的设计 | 生态现状 | 差距判断 |
|---|---|---|
| 事件日志=真相、投影可重建 | pi session JSONL（天然）；observational-memory 有 ledger 历史 | 无人把"重建"做成产品功能（/mem:rebuild）——小空白 |
| 压缩即归档 | **pi-observational-memory v3 深度实现**（后台观察/反思+压缩零模型） | 已被占，且实现更成熟 |
| 注入（开启时记忆地图） | 标配（chendpoc/samfp/memory-md/engram 全有） | 饱和 |
| 工具协议（mem_add/query/get） | 标配（mem_save/mem_search/recall/goose_remember） | 饱和 |
| **Everything 式过滤语法**（type:/entity:/since:/imp:） | **没有任何包提供**（全是关键词/向量/ID 召回） | **✅ 唯一明确空白** |
| **确定性地址引用**（#A1F3 跨会话引用语言） | observational-memory 有 12 字符 ID + recall（接近但非"地址即引用"） | 半空白，可深化 |
| 双库（项目级+全局） | @pi-unipi/memory 有 | 饱和 |
| 敏感信息策略 | chendpoc（脱敏）、engram（private 块） | 饱和 |
| 本地小模型提取 | pi-goosedump（gpt-oss-20b）、augment、loreai 本地 embedding | 已有人做（且用户已否决此路线） |
| 压缩后 LLM 复盘入库（用户新要求） | observational-memory 的 reflection 最接近 | 半空白 |

---

## 四、战略建议

### 现实判断

用户原计划的"自建记忆内核"在 pi 生态中属于**红海中的红海**：30+ 竞争者，且
`pi-observational-memory`（压缩记忆）、`@chendpoc/pi-memory`（跨会话+脱敏）、
`gentle-engram`（共享大脑）三个方向分别把我们的核心设想实现了 80%+。

### 三条可选路线

**路线 A：寻址语言层（最小差异化，推荐优先评估）**
不写存储、不写注入、不写压缩。写一个**薄查询层**：
- Everything 语法解析 + 统一寻址接口（`#addr` / `type:` / `entity:` / `since:` / `imp:`）
- 挂接在现有记忆之上（如 observational-memory 的 ID、chendpoc 的 MEMORY.md、或自建 SQLite 索引）
- 提供 `/mft` 命令 + mem_query 工具
- 风险：价值依赖底层记忆质量，可能被底层包自身吸收

**路线 B：深度定制最接近者（中等投入）**
Fork `@chendpoc/pi-memory`（Markdown 真相 + 注入 + 脱敏已齐）或
`pi-observational-memory`（压缩记忆已齐），叠加：
- Everything 查询语法（真正的空白点）
- 压缩后 LLM 复盘入库（用户新要求，observational 的 reflection 是半成品）
- 确定性地址引用语言
- 双库项目隔离
风险：fork 维护成本、上游演进分叉

**路线 C：继续自建（高投入，仅当 A/B 验证不足时）**
按 DESIGN-PI.md 自建，但必须**只做空白点组合**（寻址语言 + 地址引用 + 重建纪律 + 复盘入库），
不复刻已饱和的注入/工具/压缩。

### 立即行动建议（低成本验证）

```bash
# 先装 3 个最相关包实测体验，再决定 A/B/C
pi install npm:pi-observational-memory      # 压缩记忆（观察+反思）
pi install npm:@chendpoc/pi-memory          # 跨会话 Markdown + 脱敏
pi install npm:gentle-engram                # 共享大脑（可选，需 Go 二进制）
```

实测对比它们的注入格式、查询能力、压缩体验后，再定路线。
