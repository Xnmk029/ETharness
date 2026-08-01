# ETharness

**Agent MFT** —— 面向 [Pi](https://pi.dev) 的记忆寻址层：Everything 式过滤语法 + 确定性地址，跨会话精确寻址散落在各记忆后端的事实。

## 简介

传统 Agent 记忆系统竞争的是"谁抽取得好"（模型能力）。ETharness 的差异化在于**记忆的寻址、存储、调用**三轴工程架构——如同 Everything 之于 Windows 文件系统：不替代资源管理器，而是做一个挂在文件系统上的索引层。

调研结论（详见 [research/](research/)）：

- 生态中已有的记忆扩展（mem0、MemOS、MemPalace、pi-observational-memory、@chendpoc/pi-memory 等）已覆盖存储、注入、压缩、脱敏
- **仍无人实现**：Everything 式过滤语法、确定性地址引用、跨会话可重建投影、记忆浏览器
- ETharness 只做空白点：不造存储/注入/压缩，只造寻址层

## 核心能力

- **Everything 语法寻址**：`type:decision entity:auth since:2w imp:>0.6`、`#A1F3`、`--term` 排除
- **确定性地址**：每条记忆有稳定地址（`#A1F3`），Agent 可跨会话引用；`mem_supersede` 建立决策取代链
- **跨会话可重建投影**：镜像（SQLite）可从后端全量重建（`/mft:rebuild`），地址稳定不重用
- **双库设计**：项目级（`.pi/agent-mft/mirror.sqlite`）+ 全局（`~/.pi/agent/agent-mft/mirror.sqlite`）合并查询
- **首轮评估注入**：会话首轮按规则评估是否注入记忆地图（可 `/mft:inject` 手动触发）
- **DeepSeek 缓存感知记忆层**：稳定热区注入 + 缓存统计面板 + 缓存窗口管理 + 跨会话全局缓存（命中价 $0.0028/M vs 未命中 $0.14/M，50 倍差价）
- **零原生依赖**：存储层使用 Node 内置 `node:sqlite`（WAL 模式）

## 架构

```
用户 / Agent
   |  mem_query "type:decision entity:auth since:2w"
   v
+----------------------------------------------+
| Agent MFT 寻址层 (agent-mft)                  |
|  - 寻址引擎   (query.ts, Everything 语法)      |
|  - 地址系统   (addr.ts, 确定性短码)            |
|  - 镜像投影   (mirror.ts, SQLite 可重建)       |
|  - 运行时     (runtime.ts, 双库合并)           |
|  - 工具/命令  (mem_* 工具, /mft 命令)          |
+--------+-------------+-------------+---------+
         |             |             |
   chendpoc 适配器   obs 适配器    manual 适配器
   (MEMORY.md)    (session ledger)  (镜像自身)
         |             |             |
   @chendpoc/    pi-observational-   mem_add /
   pi-memory     memory              /mft:add
```

设计原则：**后端是真相，镜像只是投影**。镜像可随时丢弃并从后端重建；重建时 `backend_key -> addr` 映射保持稳定，地址永不重用。

## 快速开始

```bash
# 1. 将 agent-mft 加入 pi 扩展（或写入 ~/.pi/agent/settings.json 的 extensions）
pi install /absolute/path/to/agent-mft

# 2. 重启 pi
# 3. 验证
/mft:stats
```

首次启动时若镜像为空，扩展会自动从已安装的记忆后端重建投影。

## Agent 工具

| 工具 | 说明 |
|---|---|
| `mem_query {expr, limit?}` | Everything 语法寻址查询 |
| `mem_get {addr}` | 展开记忆原文（元数据 + 后端溯源） |
| `mem_add {filename, kind, entity?, path?, importance?, content?}` | 记录持久记忆，返回地址 |
| `mem_supersede {old_addr, new_addr}` | 标记旧决策被取代 |
| `mem_revoke {addr}` | 撤销错误记忆 |

## 用户命令

| 命令 | 说明 |
|---|---|
| `/mft <expr>` | 浏览记忆（过滤、选择、展开），Tab 补全语法 |
| `/mft:add <描述> [kind=decision] [entity=x] [imp=0.8]` | 手动记录 |
| `/mft:inject` | 手动注入记忆地图到下一轮 |
| `/mft:rebuild` | 从后端重建镜像投影 |
| `/mft:stats` | 镜像统计 |

## 后端适配器

| 后端 | 数据来源 | 说明 |
|---|---|---|
| `chendpoc` | `~/.pi/pi-memory-data/MEMORY.md` + `auto-*.md` | 解析 @chendpoc/pi-memory 的跨会话 Markdown 真相（含溢出文件、`[user]` 标记、区块映射） |
| `obs` | `~/.pi/agent/sessions/**/*.jsonl` | 解析 pi-observational-memory 的会话 ledger（observations/reflections），支持证据回放 |
| `manual` | 镜像自身 | `mem_add` / `/mft:add` 直接写入，重建时保留 |

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MFT_MEMORY_DIR` | `~/.pi/pi-memory-data` | chendpoc 记忆目录 |
| `MFT_SESSIONS_DIR` | `~/.pi/agent/sessions` | pi 会话目录 |
| `MFT_GLOBAL_DB` | `~/.pi/agent/agent-mft/mirror.sqlite` | 全局镜像路径 |

## 开发与测试

```bash
cd agent-mft
node --test    # 46 个单元测试（Node 24 原生 TS，零依赖）
```

要求：Node.js >= 24（`node:sqlite`），pi >= 0.83。

## 文档

- [设计文档](docs/DESIGN-PI.md) —— v0.3 战略与实现设计
- [生态调研](research/pi-memory-ecosystem.md) —— pi 记忆扩展生态全景
- [源码拆解](research/pi-memory-deepdive.md) —— pi-observational-memory 与 @chendpoc/pi-memory 拆解
- [模型选型](research/model-selection-v4flash.md) —— DeepSeek-V4-Flash-0731 评估
- [MCP 记忆生态](research/mcp-memory-ecosystem.md) —— 通用记忆层调研

## License

MIT
