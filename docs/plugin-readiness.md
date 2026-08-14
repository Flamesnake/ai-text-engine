# 插件就绪与发布清单

本文件定义“核心已经值得封装成插件”的工程边界。插件只负责安装、发现、配置和调用；剧情模型、MCP、校验、运行时与导出仍是宿主无关核心。

## 当前范围

首个插件候选必须具备：

- 严格、带版本的 Story schema，MCP 写入前拒绝未知字段；
- `story_validate`、walk 可达/覆盖/失败见证、DOM 见证重放；
- `story_evaluate` 事实指标与本地 MCP 成本观测；
- 安全的短促合成音效、动画参数和显式运行时销毁；
- 受控富文本、条件揭示、纯文本回退和无任意 HTML/CSS；
- 单 HTML 导出、MCP 自检、代表项目回归和变更日志。

叙事声景、世界状态主题切换、拟态网页、空间调查、3D 与 Meta 是后续核心能力，不阻塞首个插件。

## 一条命令发布自检

```bash
npm run check:release
```

它按顺序执行一次构建（含 TypeScript 检查）、完整测试、真实 MCP stdio 握手、`projects/*/story.json` 语料校验，以及 npm tarball 空目录安装。安装验收会运行 CLI doctor、已安装 MCP 握手和单 HTML 导出。任一步失败即返回非零状态；不再额外执行一次重复 typecheck。

单独诊断时可使用：

```bash
npm run build
node scripts/verify-mcp.mjs
npm run check:projects
npm run check:package
```

## 插件封装前最后检查

1. `npm run check:release` 输出 `RELEASE CHECK OK`。
2. `SCHEMA_VERSION` 已按兼容性变化更新；旧项目能迁移或给出可读错误。
3. MCP 工具清单与 Skill 工具速览一致，README 和 Skill 已同步。
4. 至少两部不同结构的代表作品完成静态、walk、DOM 与真人试玩回归。
5. `CHANGELOG.md` 写明新增契约、兼容性和已知限制。
6. 固定核心版本后再制作 DeepSeek Harness 或 Codex 的薄封装，禁止在插件内复制核心逻辑。

## 安装后的健康检查契约

通用安装流程最终只需证明：Node 运行时可用、CLI doctor 通过、MCP 返回完整工具清单、预构建运行时可以导出单 HTML、Skill 可显式安装。作品写入用户数据目录或 `TALESPINDLE_HOME`，不得写入 `node_modules`；旧变量 `AI_TEXT_ENGINE_HOME` 仅作为兼容回退。若失败，应直接显示缺失项和修复命令，不让创作 Agent 通过导入 handler 或临时 stdio 脚本绕过配置。

## npm 准备状态

- 已有 `dist/cli.js`，提供 `doctor`、`init`、`mcp`、`install-skill` 和 `version`；
- 发布清单只包含 `dist`、`skill`、README、CHANGELOG 和 LICENSE；
- 构建会清理旧 dist 并排除测试产物；导出器优先读取预构建 runtime，不要求用户安装 esbuild；
- MCP SDK 已归入运行依赖；tarball 会在空目录以 `--omit=dev` 安装验证；
- npm 包名为 `@marianaj/talespindle`，`0.1.0` 已公开发布；`0.2.0` 候选已通过发布白名单与空目录安装验收，仍需在合并前复核 tarball 并显式执行发布命令。
