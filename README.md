# ETharness

**Agent MFT** —— 面向 [Pi](https://pi.dev) 的记忆寻址层。本项目实现 Everything 风格的过滤语法与确定性地址，支持跨会话、跨后端精确定位 Agent 记忆。

## 概述

Agent 会话的记忆通常受限于单次上下文窗口，跨会话的一致性依赖重复阐述或摘要压缩。本项目的核心抽象是一层独立的记忆寻址系统，其设计目标包括：

- 以过滤表达式定位记忆（类型、实体、路径、时间、重要性、状态等维度）
- 为每条记忆分配稳定地址，支持跨会话引用与取代关系追踪
- 以镜像投影（SQLite）统一多后端记忆，投影可从后端重建
- 以常驻记忆集构成稳定前缀，配合 DeepSeek 磁盘缓存实现低成本跨会话在场

系统以 Pi 扩展（`agent-mft/`）与图形界面（`gui/`）两种形态提供，存储层基于 Node 内置 `node:sqlite`，无原生依赖。

## 特性

- **过滤语法寻址**：`type:decision entity:auth since:2w imp:>0.6`、`#A1F3`、`--term` 排除
- **确定性地址**：Base36 短码，地址永不重用，跨会话引用稳定
- **可重建投影**：镜像可从后端（chendpoc、obs、manual）全量重建，地址映射保持稳定
- **双镜像**：项目级（`.pi/agent-mft/mirror.sqlite`）与全局（`~/.pi/agent/agent-mft/mirror.sqlite`）合并查询
- **常驻记忆**：钉住或高重要性记忆构成稳定前缀，每轮注入系统提示，跨会话低成本在场
- **缓存遥测**：记录缓存命中与未命中 token，按模型价差估算节省
- **创作向类型**：人物、世界观、灵感、素材、计划、事件、风格等记忆类型

## 架构

```
用户 / Agent
   |  mem_query "type:decision entity:auth since:2w"
   v
+-----------------------------------------------+
| 寻址层 (agent-mft)                              |
|  - 查询引擎  (query.ts, 过滤语法)                |
|  - 地址系统  (addr.ts, 确定性短码)               |
|  - 镜像投影  (mirror.ts, SQLite, 可重建)         |
|  - 运行时    (runtime.ts, 双镜像合并)            |
|  - 工具/命令 (mem_* 工具, /mft 命令)             |
+---------+-------------+--------------+---------+
          |             |              |
   chendpoc 适配器   obs 适配器     manual 适配器
   (MEMORY.md)    (会话台账)        (镜像自身)
```

后端为记忆真相源，镜像为投影。投影可随时删除并自后端重建。

## 快速开始

```bash
# 安装扩展（或将该路径写入 ~/.pi/agent/settings.json 的 extensions）
pi install /absolute/path/to/agent-mft

# 重启 Pi 后验证
/mft:stats
```

首次启动且镜像为空时，扩展自动自已安装的记忆后端重建投影。

## 记忆寻址语法

```
<expr> := <term> ( <space> <term> )*
<term> := <keyword>                  # 文件名子串匹配
        | type:<kind>                # 记忆类型
        | entity:<name>              # 实体匹配
        | path:<a/b>                 # 层级前缀
        | backend:<obs|chendpoc|manual>
        | since:<1h|1d|2w|3m|1y>     # 时间窗
        | imp:>0.7                   # 重要性比较
        | status:active|superseded|revoked
        | #<ADDR>                    # 确定性地址
        | --<term>                   # 排除
```

示例：`type:decision entity:auth since:2w`、`#A1F3`、`backend:chendpoc kind:preference`。

## Agent 工具

| 工具 | 说明 |
|---|---|
| `mem_query {expr, limit?}` | 过滤语法寻址查询 |
| `mem_get {addr}` | 展开记忆原文（元数据与后端溯源） |
| `mem_add {filename, kind, entity?, path?, importance?, content?}` | 记录持久记忆，返回地址 |
| `mem_supersede {old_addr, new_addr}` | 标记旧记录被取代 |
| `mem_revoke {addr}` | 撤销记录 |
| `mem_pin {addr}` / `mem_unpin {addr}` | 加入 / 移出常驻记忆集 |

## 用户命令

| 命令 | 说明 |
|---|---|
| `/mft <expr>` | 浏览记忆（过滤、选择、展开），支持语法补全 |
| `/mft:add <描述> [kind=decision] [entity=x] [imp=0.8]` | 手动记录 |
| `/mft:pin <addr>` / `/mft:unpin <addr>` | 常驻集管理 |
| `/mft:resident` | 查看常驻记忆集 |
| `/mft:inject` | 手动注入记忆地图 |
| `/mft:rebuild` | 自后端重建镜像投影 |
| `/mft:stats` / `/mft:cache` | 镜像统计 / 缓存遥测 |

## 常驻记忆与缓存

常驻记忆集由钉住记录与高重要性记录构成，按地址稳定排序。该集合每轮追加至系统提示末尾，内容保持字节级稳定，符合 DeepSeek 磁盘缓存的前缀匹配条件（命中价 $0.0028/M，未命中价 $0.14/M，V4-Flash）。动态检索结果以消息形式注入首轮，不影响常驻前缀。

缓存使用情况自 `message_end` 的 usage 字段采集，`/mft:cache` 输出命中率与按价差估算的节省额。

## 图形界面

`gui/` 提供零依赖的本地界面：Pi RPC 子进程承载对话，agent-mft 内核直接复用（Node 24 类型擦除导入）。界面包含记忆浏览器（过滤、标签、钉住）、流式对话与缓存仪表盘。

```bash
node gui/server.ts --project "G:/产品/harness"   # 打开 http://127.0.0.1:8787
```

## 后端适配器

| 后端 | 数据来源 | 说明 |
|---|---|---|
| `chendpoc` | `~/.pi/pi-memory-data/MEMORY.md` + `auto-*.md` | 解析跨会话 Markdown 真相（溢出文件、`[user]` 标记、区块映射） |
| `obs` | `~/.pi/agent/sessions/**/*.jsonl` | 解析会话台账（observations / reflections），支持证据回放 |
| `manual` | 镜像自身 | 由 `mem_add` / `/mft:add` 写入，重建时保留 |

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `MFT_MEMORY_DIR` | `~/.pi/pi-memory-data` | chendpoc 记忆目录 |
| `MFT_SESSIONS_DIR` | `~/.pi/agent/sessions` | Pi 会话目录 |
| `MFT_GLOBAL_DB` | `~/.pi/agent/agent-mft/mirror.sqlite` | 全局镜像路径 |
| `PI_CLI` | npm 全局路径探测 | Pi CLI 位置（GUI） |

## 开发

```bash
cd agent-mft
node --test    # 53 个单元测试（Node 24 原生 TypeScript）
```

要求：Node.js >= 24（`node:sqlite`），Pi >= 0.83。

## 文档

- [设计文档](docs/DESIGN-PI.md)
- [产品定位](docs/PRD.md)
- [GUI 说明](gui/README.md)

## License

MIT
