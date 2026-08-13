# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 修复

- **路径探索状态剪枝**：调查中心存在多条可反复往返支线时，按“节点 + 完整模拟状态”合并等价路径，
  避免调查顺序、谜题和推论组合造成阶乘级膨胀；路径数明确作为状态路径的近似统计。

- **选项条件上下文**：`visibleChoices()` 此前只向 `when` 条件传入 `vars/inventory`，
  导致 `#day`、`#docs`、`#violated`、`#steps`、`#ending`、`#visited` 在选项中全部失效；
  现与成就求值共用完整 `ConditionContext`，并补回归测试。
- **路径探索模拟**（walk）：
  - 节点访问计数改为按路径独立复制，分支汇合节点不再被其他路径的访问误判为循环剪枝；
  - `rand` 效果改为可注入随机源（默认取中间值），模拟结果确定、可复现，不再依赖真实 `Math.random()`；
  - 条件求值补齐 `#visited`/`#steps` 上下文；
  - `minSteps` 由「首达步数」修正为真正的最小步数；
  - 警告信息去重。
- **项目存储**：`story.json` 损坏、权限错误不再被伪装成「项目不存在」，
  统一抛带 `code` 的 `ProjectError`（`CORRUPT` / `NOT_FOUND` / `WRITE_FAILED` / `CONFLICT` / `TITLE_INVALID`）。

### 新增

- **共享 Story Schema**（`src/core/schema.ts`）：zod 定义全量剧情与存档结构，
  统一用于 MCP 工具入参校验（替换 `z.any()`）、`story.json` 加载解析与版本迁移
  （缺省 `meta.version` 自动补齐）。
- **存储深模块**：原子写入（临时文件 + rename）、标题碰撞自动分配独立目录（稳定项目 ID）、
  读取后外部修改的并发冲突检测。
- **模板拆分**（`src/export/template.ts`）：内联 CSS 与 HTML 骨架从 exporter 中独立。
- CI 工作流（`.github/workflows/ci.yml`）、`LICENSE`（MIT）。
- **证据组合推理 MVP**：新增 Evidence / Deduction 领域模型、证据获取效果、
  `#evidence` / `#deduction` 条件、幂等推论确认接口与存档支持。
- **推理创作工具**：新增证据和推论的 MCP upsert/delete 工具；校验器检查无效引用，
  路径探索会考虑场景外推论动作并在组合过多时明确截断警告。
- **玩家线索板**：玩家可查看已获得证据、选择待证明命题、组合证据并解锁新内容；
  仓库附带《停在十点十分的钟》可导出样例。
- **人物关系 MVP**：新增结构化 Character、关系维度、关键记忆与秘密；关系条件、记忆条件和秘密条件可用于选项，
  路径探索和校验器理解相同语义。
- **人物创作与运行时**：新增人物 upsert/delete MCP 工具及玩家人物页；附带《走廊尽头的证词》样例。
- **密码谜题 MVP**：新增确定性密码验证、错误尝试计数、渐进提示、解谜成功效果和 `#puzzle` 条件；
  校验器与路径探索理解相同语义。
- **谜题创作与运行时**：新增谜题 upsert/delete MCP 工具及玩家谜题页；附带《十点十分的保险箱》样例。
- **综合悬疑纵向切片**：新增完全通过 MCP 构建的《雨夜遗嘱》，组合人物关系、秘密、搜证、
  场景谜题、证据推论与三结局；附真实运行时 DOM 验收脚本覆盖完整真相路线。

### 文档

- README 测试数量更新为 111；「全路径模拟」统一改述为「路径探索模拟（近似）」。
- 配套 skill 增加体验意图提炼、先设计真相与证据链、使用结构化证据和推论工具的工作流。
