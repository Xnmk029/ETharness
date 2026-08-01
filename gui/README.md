# ETharness GUI

记忆优先的图形化界面：pi 内核（RPC）+ agent-mft 记忆寻址层 + 零依赖 Web 前端。

## 运行

```bash
# 从项目根目录（自动使用当前目录作为项目）
node gui/server.ts

# 指定项目目录
node gui/server.ts --project "G:/产品/harness"

# 指定端口
MFT_PORT=9000 node gui/server.ts
```

打开 http://127.0.0.1:8787

要求：Node.js >= 24，pi 已安装（自动探测 npm 全局路径，可用 `PI_CLI` 环境变量覆盖）。

## 界面

- **左栏 · 记忆**：Everything 式过滤（`type:character`、`entity:苏晚`、`since:2w`、`#A1F3`）、创作向标签（人物/世界观/灵感/素材…）、钉住操作（常驻 = 稳定前缀，缓存免费在场）
- **中栏 · 对话**：pi RPC 流式对话（复用全部 pi 能力：工具、会话、压缩、agent-mft 注入）
- **右栏 · 详情/仪表盘**：记忆原文展开、撤销操作；缓存命中率与估算节省

## API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/memory?expr=` | GET | 寻址查询 |
| `/api/memory` | POST | `{action: add\|pin\|unpin\|supersede\|revoke, ...}` |
| `/api/resident` | GET | 常驻记忆集 |
| `/api/cache` | GET | 缓存遥测（命中率/节省） |
| `/api/stats` | GET | 镜像统计 |
| `/api/chat` | POST | SSE 流式对话（`{message}`） |

## 架构

```
浏览器 ── HTTP/SSE ──► server.ts（Node，零依赖）
                        ├─ pi RPC 子进程（对话：prompt 命令 + 事件流）
                        └─ agent-mft 内核（直接 import，记忆寻址/常驻区/遥测）
```
