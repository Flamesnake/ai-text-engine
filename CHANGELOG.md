# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 变更

- GitHub 仓库由 `Flamesnake/ai-text-engine` 更名为 `Flamesnake/talespindle`，并更新 npm repository、homepage、bugs 与源码路径示例；旧 GitHub URL 由 GitHub 自动重定向。

## [0.2.0] - 2026-08-14

### 变更

- **TaleSpindle 品牌与 npm 身份**：公开包名确定为 `@marianaj/talespindle`，CLI、MCP serverInfo 与配套 Skill 切换到 `talespindle` / `talespindle-author`。暂时保留 `ai-text-engine` CLI 别名与 `AI_TEXT_ENGINE_HOME` 环境变量作为兼容回退；个人作品仍由 npm `files` 白名单排除。
- **评估成本分层**：`story_evaluate` 默认使用 1 万状态的快速诊断预算，完整结局证明与热点分析继续由可调预算的 `story_walk` 承担，避免体验检查无意重复昂贵探索。

### 修复

- **DOM 批量验收退出**：见证重放新增显式销毁版本，验证脚本在每条路线后释放动画、音频与 happy-dom timer，避免结果已经打印却因残留句柄超时。
- **Codex Skill 安装位置**：`install-skill --client codex` 改为写入 Codex 当前自动发现的 `~/.agents/skills/talespindle-author`，与通用 Agent 目录一致，不再使用旧的 `~/.codex/skills`。
- **声画输入与生命周期**：节点 `sfx` 改为共享严格枚举并补齐 `ending_hidden`；`fx.intensity`/`speed` 增加安全边界。音频使用主增益实现即时静音，支持挂起恢复与显式销毁，不再依赖未知音效运行时静默失败。
- **受控富文本与条件揭示**：文本块新增严格 `segments`，支持 emphasis/italic/blood/whisper/redacted/glitch/corrupt/terminal/handwritten/broadcast；揭示条件参与引用校验，未满足时真实文本不进入 DOM，保留纯文本回退且不开放任意 HTML/CSS。
- **统一发布自检**：新增 `npm run check:release`，复用构建、完整测试、真实 MCP 握手和项目语料校验；为后续薄插件封装提供稳定健康检查契约，避免 Agent 重复排查与重复 typecheck。
- **通用 npm CLI 与安装隔离**：新增 `doctor/init/mcp/install-skill/version` 入口；预构建包把作品写入用户数据目录或 `TALESPINDLE_HOME`，不再写入 `node_modules`。发布白名单排除源码测试、临时文件与个人作品，并用空目录生产依赖安装、MCP 握手和真实 HTML 导出验证 tarball。
- **集合型特殊条件语义**：`#visited`、`#docs`、`#evidence`、`#deduction`、`#violated`、`#memory`、`#secret`、`#puzzle` 现在同时支持 `eq/ne` 与 `has/not_has`；修复 `has` 被提前当作普通道具检查、导致运行时和 walk 错判不可达的问题，并增加推论与谜题回归测试；
- **推理结局可发现性**：玩家获得证据后，在场景主要行动区显示“整理线索并推理”入口；
  线索板补充选择推论、勾选证据、验证推论的操作说明，避免关键结局只由顶部工具按钮隐式解锁。
- **路径探索状态剪枝**：调查中心存在多条可反复往返支线时，按“节点 + 完整模拟状态”合并等价路径，
  避免调查顺序、谜题和推论组合造成阶乘级膨胀；路径数明确作为状态路径的近似统计。
- **无关访问历史剪枝**：walker 的状态键只保留被剧情 `#visited` 条件实际引用的节点；
  运行时与条件求值仍保留完整访问历史，但纯参观顺序不再制造指数级子集状态。

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

- **增量叙事修订工具**：新增 `story_get_node`、分页 `story_review_transitions` 与带旧值断言的 `story_patch_choice`。Agent 可用紧凑的“末段 → 选项 → response → 首段”上下文集中检查衔接，并只修改一个选项，减少全量读取、重复覆盖和过期索引误改。
- **选择后的叙事承接**：`choice.response` 可在目标节点正文前显示一两句即时反应，支持变量插值与存档恢复；`story_evaluate` 会定位不同选项汇流但缺少完整承接的高风险边。
- **叙事质量工作流**：Skill 新增按需加载的声纹表、连续性卡、去模板化编辑与逐边连读检查；评估器只报告重复开头等可核实候选，不伪装成 AI 文风检测器。
- **状态轴有效性诊断**：评估器会提示只写不读且没有可见表现的 world/phase，以及两个状态轴同时拥有基础声景时的覆盖风险。
- **结构化世界状态**：新增 `world` / `phase` 两条受控状态轴，贯通效果、条件、插值、存档、walk、校验、评估、MCP 与运行时；状态可集中覆盖主题、视觉配方和持续声景，并在切换时使用支持减弱动态的固定过渡。状态级差异替代逐节点重复样式，减少创作 token 浪费。
- **受控持续声景**：新增 rain/wind/storm/waves/broadcast/electric/ventilation/engine/void 九种程序化环境声与 subtle/medium/strong 语义强度。声景只在变化点声明、跨节点持续、切换时交叉淡化，支持 `silence`、历史恢复、即时静音和销毁；`story_evaluate` 会提示逐节点重复声明，避免配置与 token 浪费。

- **结局见证与覆盖拆分**：walk 现在分别返回 `reachability` 与 `coverage`；主探索超出预算时，会为尚未证明的结局追加目标导向搜索并输出可重放的选择、推论和谜题动作。Agent 不再需要仅为满足全覆盖预算而把合理的自由调查线性化；覆盖不完整仍会诚实报告死路风险。
- **DOM 见证重放器**：新增 `replayWitnessInDom` 与 `verify-dom-witnesses.mjs`，自动操作真实运行时的开始、选项、推理板、谜题输入、提交、返回和重渲染；失败摘要只包含动作位置、节点和可见选项，减少每部作品重复编写验收路线及无用正文回传。
- **失败路径见证**：walk 现在记录 `soft_lock` 与 `invalid_terminal` 的最短可重放路径，并区分失败搜索是否完整；仍可确认推论或解谜时不会误报软锁。`story_evaluate` 会把实际找到的失败路径列为明确候选问题，DOM 验收器会复现并以非零状态退出。
- **选择质量与机制回收**：`story_evaluate` 新增无状态原地循环、同节点重复结果、未回收证据、未回收推论和未回收谜题指标；结果按高置信结构事实输出为 `info` 候选，并限制证据列表长度，避免机械改稿和冗长 token 回传。
- **声画体验诊断**：`story_evaluate` 新增连续 `drone`、重复系统音效、长正文持续强动画和高强度动画候选，帮助 Agent 集中调整少量叙事峰值而非逐节点铺效果。
- **作品评估工具**：新增 `story_evaluate`，用中立、机器可读的指标报告有效选择、
  单选走廊、重复导航、机制使用、声画覆盖与 walk 健康度；不打总分，未采用的可选机制不被机械告警。
- **本地 MCP 成本观测**：新增 `story_observability` 与 `story_observability_reset`，
  聚合记录工具调用、失败、JSON 字节、粗略 token、耗时、全量读取和重复资源覆盖；
  不保存剧情正文，并为同题 Agent 盲测提供可比较摘要。
- **walk 自诊断**：`story_walk` 现支持 `maxStates`、`maxDepth`、`maxNodeVisits`、
  `maxDeductionVariants`、`diagnostics` 与 `topNodes`；结果返回预算占用和高频热点节点，
  在使用率达到 80% 时主动警告，减少反复读取全量剧情和手工插桩的 token/时间浪费。
- **Skill 渐进披露**：将推理公平性、walk 调优和 happy-dom 运行时验收拆到按需 reference，
  主 Skill 只保留路由、通用契约和验收红线，避免每次创作都加载全部专项说明。
- **可组合视觉表达系统**：新增 `PresentationConfig` 与 `story_set_presentation`，用
  `shell / typography / density / shape / choiceStyle` 五个短枚举组合界面风格；提供
  `novel / dossier / chat / cinematic` 四种真正改变构图的外壳，节点可仅覆盖差异项。
- **视觉配置效率检查**：三个以上节点重复同一 `presentation` 时给出体验警告，提示提升到全局配置，
  避免 story 数据与 Agent token 被重复样式描述占用。

- **玩家目标与一次性机制教学**：节点支持 `objective` 当前目标；首次遇到人物关系、场景谜题或推理板时显示可关闭教学并随存档记忆；获得新证据时明确提示已加入推理板。
- **推理板语义与进度**：原“线索板”统一更名为“推理板”，展示必需证据与替代证据组完成度；推论可用非剧透 `hint` 指引下一步调查。
- **非阻断体验校验**：`story_validate` 返回 `experienceWarnings`，提醒多行动场景缺少目标、推论缺少方向、谜题未放置到场景及坏结局后果不明确，不影响结构校验和导出。

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

- 新增三道 Agent 创作盲测题与独立隐藏评分表，覆盖悬疑推理、人物关系和科幻探索；评分单列“氛围与特效叙事”，评估语义匹配、克制、参数、氛围曲线与声画协同，而非机械统计使用数量。
- README 测试数量更新为 111；「全路径模拟」统一改述为「路径探索模拟（近似）」。
- 配套 skill 增加体验意图提炼、先设计真相与证据链、使用结构化证据和推论工具的工作流。
