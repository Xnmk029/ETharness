# agent-mft — Pi 的"Everything"

面向 pi 的记忆寻址层：用 Everything 式过滤语法 + 确定性地址，跨会话精确寻址散落在各记忆后端的事实。

**设计文档**：`../docs/DESIGN-PI.md`（v0.3）｜**调研报告**：`../research/`

## 核心能力

- **Everything 语法寻址**：`type:decision entity:auth since:2w imp:>0.6`、`#A1F3`、`--term` 排除
- **确定性地址**：每条记忆有稳定地址（`#A1F3`），Agent 可跨会话引用；`mem_supersede` 建立决策取代链
- **跨会话可重建投影**：镜像（SQLite）可从后端全量重建（`/mft:rebuild`），地址稳定不重用
- **双库**：项目级（`.pi/agent-mft/mirror.sqlite`）+ 全局（`~/.pi/agent/agent-mft/mirror.sqlite`）合并查询
- **首轮评估注入**：会话首轮按规则评估是否注入记忆地图（可 `/mft:inject` 手动）

## 安装

```bash
# settings.json 的 extensions 加入本目录路径（已安装），或：
pi install /absolute/path/to/agent-mft
```

重启 pi 后生效。

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
| `/mft <expr>` | 浏览记忆（过滤 → 选择 → 展开），Tab 补全语法 |
| `/mft:add <描述> [kind=decision] [entity=x] [imp=0.8]` | 手动记录 |
| `/mft:inject` | 手动注入记忆地图到下一轮 |
| `/mft:rebuild` | 从后端重建镜像投影 |
| `/mft:stats` | 镜像统计 |

## 后端适配器

| 后端 | 来源 | 说明 |
|---|---|---|
| `chendpoc` | `~/.pi/pi-memory-data/MEMORY.md` + auto-*.md | @chendpoc/pi-memory 的跨会话 Markdown 真相 |
| `obs` | `~/.pi/agent/sessions/**/*.jsonl` | pi-observational-memory 的会话 ledger（observations/reflections） |
| `manual` | 镜像自身 | `mem_add` / `/mft:add` 直接写入 |

> 适配器枚举后端记录 → 镜像投影可重建；后端是真相，镜像可随时丢弃。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `MFT_MEMORY_DIR` | `~/.pi/pi-memory-data` | chendpoc 记忆目录 |
| `MFT_SESSIONS_DIR` | `~/.pi/agent/sessions` | pi 会话目录 |
| `MFT_GLOBAL_DB` | `~/.pi/agent/agent-mft/mirror.sqlite` | 全局镜像路径 |

## 开发

```bash
node --test        # 46 个单元测试（Node 24 原生 TS）
```

## 状态

- [x] M1 寻址引擎（query.ts）
- [x] M2 地址系统 + 镜像（addr.ts / mirror.ts）
- [x] M3 适配器 + 重建器（chendpoc / obs / manual / rebuild.ts）
- [x] M4 运行时 + 工具 + 命令 + 首轮注入（runtime.ts / tools.ts / commands.ts / index.ts）
- [x] M5 全量测试 + pi 端到端冒烟（注入 + mem_query 实测通过）
- [ ] M6 可选：LLM 评估注入模式、记忆地图 TUI 渲染、敏感信息过滤、session_compact 自动同步
