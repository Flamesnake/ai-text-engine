# @dsh-external/dsh-talespindle

DeepSeek Harness 插件：**TaleSpindle 本地 MCP 薄封装**（工具包形态）。

按主仓库的 [plugin-readiness](../../docs/dev/plugin-readiness.md) 约定，插件只负责**安装检查、会话管理、工具透传与导出入口**；剧情模型、校验、walk、运行时与导出仍是宿主无关核心（npm 包 `@marianaj/talespindle`），本插件不复制任何核心逻辑。

插件随主仓库 `plugins/dsh-talespindle/` 一起维护；独立发布物（GitHub Release 附件 tgz）从这里构建。

## 工具面（5 个）

| 工具 | 用途 |
|---|---|
| `talespindle_status` | 安装状态：CLI 路径、版本、可用 story_* 工具数（未安装给出指引）。**首轮锚定保留项** |
| `talespindle_ensure` | 确保本地 MCP 会话就绪，返回服务器信息与工具清单 |
| `talespindle_call` | 透传调用任意 story_* 工具（`{tool, args}`），如 story_new/story_get/story_upsert_node/story_validate/story_walk |
| `talespindle_projects` | 列出本地项目（名称/节点/结局数） |
| `talespindle_export` | 校验并导出指定项目为单文件 HTML，返回 outputPath 与大小 |

首轮锚定：会话尚无任何 tool/call 时只暴露 `talespindle_status`，首个工具调用后恢复全部工具。

## CLI 定位顺序

1. `TALESPINDLE_CLI` 环境变量（显式指定 `dist/cli.js` 路径）
2. npm 全局安装：`npm root -g` 下 `@marianaj/talespindle/dist/cli.js`
3. 开发回退：主仓库根的 `dist/cli.js`（插件位于 `plugins/dsh-talespindle/`，本地注入/联调场景）

## 构建与注入

```bash
# 构建（需要 DSH 源码 checkout 提供 tsc 与依赖链接）
DSH_CHECKOUT=<dsh-checkout> bash scripts/build.sh
# 注入（DSH 环境内，路径指向主仓库内插件目录）
dev_inject_plugin E:\GAMER\wzkb\ai-text-engine\plugins\dsh-talespindle
# 热重载 / 卸载
dev_reload_package dsh-talespindle
dev_uninject_plugin dsh-talespindle
```

npm 安装形态的 DSH（无 `packages/` 布局）可手工等价构建：

```bash
# 用 ai-text-engine 的 tsc 编译（依赖 junction 需先按 build.sh 的 link 列表建立）
node_modules/.bin/tsc -p tsconfig.json
```

## 验证

- `lib/mcp-client.js` 是零依赖的 MCP stdio 客户端（换行分隔 JSON-RPC），可直接冒烟：
  建项目 → 导出 → 错误路径，见 `smoke` 说明（已随验证删除，重新编写即可）。
- 注入后 `dev_plugin_status` 应显示 `[active] ... [injected]`；`dev_reload_package` 热重载后 fiber 保持 active。
- 工具调用走真实 `talespindle mcp` 子进程，MCP 侧错误会以 `{ok:false, error}` 返回，不会抛进宿主。

## 生命周期

- MCP 子进程按需创建、进程级缓存；插件卸载/热重载时随 `ctx.effect` cleanup 主动 `kill` 回收。
- `idleMinutes`（默认 30）可配置空闲自动回收（0 = 不自动关闭）。

## 与宿主 MCP 客户端的区别

宿主若已通过 `dsh-mcp-client` 注册 `mcp-talespindle`（常驻 MCP 工具），本插件的工具仍可并存：前者把 story_* 直接铺进工具面，后者提供显式的安装诊断、会话管理与按需透传，适合排查安装问题或控制工具面大小。
