---
name: talespindle-author
description: 用 TaleSpindle 的 MCP 工具制作 HTML 互动叙事游戏。当用户想体验文字冒险、互动小说、分支故事、悬疑调查、证据推理或轻量解谜时使用。理解用户想要的体验，完善剧情设计，通过 story_ 工具构建并导出可直接游玩的单文件 HTML。
---

# TaleSpindle · Agent 互动叙事创作指南

通过 MCP 服务器 `talespindle` 用工具构建文字冒险游戏，最终交付一个**自包含单文件 HTML**（双击即玩、可发任何人、零依赖）。剧情是纯 JSON 数据，无需写代码。

前置条件：AI 客户端已连接 `talespindle` MCP 服务器（工具名以 `story_` 开头）。旧配置中的服务器键名 `ai-text-engine` 仍可继续使用。

## 开工前检查与 MCP 故障处理

先确认当前能力列表中确实存在 `story_new`、`story_validate`、`story_export` 等 `story_` 工具。Skill 可见不代表 MCP 已连接；不要尝试调用名称相近的其他服务器。

如果工具不可用，并且当前工作区是 TaleSpindle 源码仓库：

1. 运行 `npm install`（仅在依赖缺失时）与 `npm run build`，再运行 `node dist/cli.js doctor`，确认 MCP、预构建运行时、Skill 和作品目录均为 OK。
2. 运行 `node scripts/verify-mcp.mjs`；只有输出 `VERIFY OK` 才说明服务器本身可启动。
3. 检查客户端 MCP 配置是否注册 `talespindle`，命令指向该工作区的绝对路径 `dist/cli.js mcp`。仓库根目录 `.mcp.json` 不是通用标准，也不能证明 Codex 已注册服务器。Codex 默认读取 `~/.codex/config.toml`，可信项目可读取 `.codex/config.toml`；可用 `codex mcp add talespindle -- node <绝对路径>/dist/cli.js mcp` 注册，或在设置的 MCP servers 中添加 STDIO 服务器。
4. 新增或修改配置后重启/刷新 AI 客户端会话，再检查 `story_` 工具。

仍不可用时，向用户说明阻塞并停止创作。**不要直接导入 `dist/mcp/handlers.js` 代替 MCP 创作**：这会绕过 transport 的输入边界，也无法证明用户实际配置可用。

作品目录由 `TALESPINDLE_HOME` 控制并位于其 `projects/` 子目录；旧变量 `AI_TEXT_ENGINE_HOME` 仍兼容。源码仓库默认使用仓库内 `projects/`。不要把作品写入 Skill 目录、`node_modules` 或临时脚本。正式 npm 包名为 `@marianaj/talespindle`。

## 工具速览

| 工具 | 用途 |
|---|---|
| `story_new` | 创建项目（自动生成 start + 示例结局骨架） |
| `story_get` | 读取完整剧情 JSON |
| `story_get_node` | 读取单个节点及其入边，局部修稿优先使用 |
| `story_review_transitions` | 分页审查“末段 → 选项 → response → 首段” |
| `story_patch_choice` | 只修改一个选项，并用旧值断言防止误改 |
| `story_upsert_node` | 创建/覆盖节点（结局自动登记到结局表） |
| `story_delete_node` | 删除节点（被引用时需 `force: true`） |
| `story_delete_ending` | 删除结局定义 |
| `story_upsert_achievement` / `story_delete_achievement` | 管理成就 |
| `story_upsert_document` / `story_delete_document` | 管理线索/文档（规则守则/便条/信件） |
| `story_upsert_evidence` / `story_delete_evidence` | 管理可用于推理的证据 |
| `story_upsert_deduction` / `story_delete_deduction` | 管理证据组合推论 |
| `story_upsert_character` / `story_delete_character` | 管理人物、关系维度与秘密 |
| `story_upsert_puzzle` / `story_delete_puzzle` | 管理密码谜题、渐进提示和成功效果 |
| `story_set_meta` | 主题 / HUD 统计条 / 副标题 / 作者 / 初始持续声景 |
| `story_set_presentation` | 用一组短枚举设置界面外壳、字体、密度、形状与选项风格 |
| `story_validate` | 校验 + 路径探索模拟（结局覆盖统计） |
| `story_evaluate` | 作品体验评估（互动 / 机制 / 演出 / 重复导航 / walk，不打总分） |
| `story_walk` | 结局见证与覆盖诊断（可重放路径 / 预算占用 / 热点节点） |
| `story_graph` | mermaid 分支图 |
| `story_export` | 导出单文件 HTML（校验不过会拒绝） |
| `story_list` / `story_delete_project` | 项目管理 |
| `story_observability` / `story_observability_reset` | 查看 / 清零本地工具成本摘要 |

## 标准工作流

### 先理解体验

不要收到需求后立刻写节点。先提炼：玩家身份、核心幻想、氛围、期望情绪、玩法重点、时长、难度和结局风格。只有缺失信息会实质改变作品时才追问；否则采用合理默认值继续。

悬疑/推理作品必须先确定真实事件、人物动机与隐瞒，再设计证据和推论，最后安排场景。不能先写场景、最后临时决定真相。

1. **建项目**：`story_new { title, subtitle? }` —— 标题即项目名，之后所有工具用它定位。
2. **清骨架**：`story_delete_node { nodeId: 'end', force: true }` 再 `story_delete_ending { endingId: 'e_end' }`
   （或直接用 `story_upsert_node` 覆盖 start 节点）。
3. **写节点**：`story_upsert_node { node }` 逐个写入。先全部写完再校验——中途断链是正常的。正文较多、人物对话重要或存在选项汇流时，先读取 `references/prose-and-transitions.md`；用一份全局声纹表约束文风，并为需要即时反馈的选项写短 `response`。
4. **定视觉配方/数值**（按需）：先用一句话确定作品模拟的媒介，再调用一次 `story_set_presentation` 设置高层视觉；颜色和 HUD 用 `story_set_meta { theme, hud }`。节点只在少数关键场景用 `presentation` 覆盖差异项。
5. **推理设计**（按需）：先写“结局事实—游戏内来源”账本，再用 `story_upsert_evidence` 定义证据、用 `story_upsert_deduction` 定义玩家能由这些证据推出的最小命题与非剧透 `hint`；节点用 `gainEvidence` 发放证据，用 `#deduction` 解锁新内容。
6. **人物关系**（按需）：用 `story_upsert_character` 定义人物、关系维度和秘密；关系变化同时写入 `remember`，秘密揭示应影响证据、对话或结局。
7. **轻量谜题**（按需）：用 `story_upsert_puzzle` 定义 `actionLabel`、密码、前置条件、由轻到重的提示和成功效果；在相关节点的 `puzzles` 中放置谜题，用 `#puzzle` 解锁内容。
8. **文本与转场修订**：正文完成后，用 `story_review_transitions { title, limit: 20 }` 分页连读关键边；按返回的 `choiceIndex/label/targetNodeId` 调用 `story_patch_choice` 局部补 `response` 或修正文案，并传 `expectedLabel`、`expectedTarget`。需要完整节点时用 `story_get_node`；不要为了修改一个选项读取并覆盖整部 story。
9. **校验与走查**：`story_validate { title }` —— 通过且 `walk.reachability.allEndingsProven === true`、`unprovenEndings` 为空、`walk.failures.witnesses` 为空后再继续；逐条处理非阻断的 `experienceWarnings`。失败见证必须修复或明确判定为有意设计；`failures.complete === false` 时“未发现失败”不是完整结论。`coverage.complete === false` 表示全状态覆盖不完整，必须记录风险并查看原因，但不要仅为消除它而把合理的自由调查强行线性化。调用 `story_evaluate { title }` 做快速体验诊断；它默认只用较小 walk 预算，重点审查选择承接、无效状态轴、重复结果和未回收机制，不替代完整 `story_walk`。`info` 不等于必须修改，不要为追求漂亮比例机械改稿。接近预算或包含开放探索时读取 `references/walk-performance.md`，用 `story_walk { diagnostics: true }` 定位热点。用 `story_graph` 审查分支结构。
10. **运行时验收**：静态校验与 walk 不能替代真实交互。读取 `references/runtime-testing.md`，优先重放 `walk.reachability.witnesses`，并实际操作至少一条完整真结局、一条错误结局和所有关键机制。
11. **导出交付**：`story_export { title }`，把返回的 `outputPath`（`projects/<标题>/dist/index.html`）交给用户。

需要比较 Agent 成本时，创作前调用 `story_observability_reset {}`，交付后调用 `story_observability {}`。其粗略 token 仅由 JSON 字节估算，用来发现全量读取和返工，不等同于模型平台真实 token。

## 节点数据格式速查

```jsonc
{
  "id": "node_id",                 // 唯一
  "objective": "当前目标的一句话说明", // 调查中心、谜题现场和结案阶段建议填写
  "text": "正文，{var} 插值，{#inventory} 道具列表，\\n 换行", // 必填，即使用 blocks
  "puzzles": ["safe_code"],       // 可选：在本场景显示醒目的解谜行动
  "choices": [
    {
      "label": "选项文案",
      "response": "你采取行动后，场景立即怎样回应。", // 可选：显示在下一节点正文前
      "target": "下一节点 id",
      "when": { "op": "gte", "var": "好感度", "value": 60 },  // 可选：显示条件
      "effects": { "add": { "好感度": 10 }, "gain": ["钥匙"] } // 可选：选择后生效
    }
  ],
  "ending": { "id": "e_1", "title": "结局标题", "kind": "good" }, // 结局节点：choices 为空且必带
  "onEnter": { "set": { "flag": true } }                        // 可选：进入节点生效
}
```

- **效果位置**：节点级效果只能放 `onEnter`，选择产生的效果放 `choice.effects`；StoryNode 顶层没有 `effects` 字段；
- **选择承接**：`choice.response` 是选项点击后、目标节点正文前的一两句即时反馈，支持变量插值并随存档恢复。多个语气/态度选项汇入同一节点时应分别填写；不要把下一节点整段正文复制进 response；
- **效果** `Effects`：`set`（赋值）/ `add`（数值增减）/ `rand`（随机整数，`[{var,min,max}]`）/ `violation`（记录违规规则）/ `day`（推进天数）/ `gain` / `lose`（道具）/ `gainDocs`（文档）/ `gainEvidence`（推理证据）/ `flag`（旗标，与变量同命名空间）；
- **人物效果**：`adjustRelation: [{characterId, stat, add}]` 调整关系；`remember` 记录玩家关键行为；`revealSecrets: ['角色:秘密']` 揭示秘密；
- **条件** `Condition`：`op: eq|ne|gt|gte|lt|lte|exists|has|not_has`，可组合 `and` / `or` / `not`；
  `has`/`not_has` 对普通 `var` 检查道具；对 `#visited` / `#docs` / `#evidence` / `#deduction` / `#violated` / `#memory` / `#secret` / `#puzzle` 等集合型特殊变量检查 `value` id，并兼容 `eq`/`ne`；`#steps` / `#day` 使用数值比较，`#ending` 使用 `eq`/`ne`；
- **音效/动画**：节点 `sfx` 是严格枚举（click/page/heartbeat/drone/achievement/shock/ending_good/ending_bad/ending_true/ending_hidden）；`fx` 支持 shake/flicker/glitch/pulse/**unstable**，参数 `{name, intensity?, speed?}` 中强度范围 `0.1..2`、速度范围 `0.25..4`；unstable=随机间隔连闪爆发。选项/成就/线索/结局已有自动音效，不要在节点重复手动声明系统反馈；右上角 🔊 可静音；
- **持续声景**：`story_set_meta` 的 `soundscape` 设置初始环境声，节点 `soundscape` 只写变化点；未声明节点沿用最近声景，`silence` 显式淡出。名称限 rain/wind/storm/waves/broadcast/electric/ventilation/engine/void，强度限 subtle/medium/strong。不要把持续环境误写成逐节点 `sfx: drone`，也不要在每个节点重复同一声景；
- **世界状态**：需要表/里世界或昼夜/警报差异时，在一次 `story_set_meta` 中定义紧凑的 `world` / `phase` 状态轴；状态可覆盖 `theme`、`presentation`、`soundscape`。用 `effects.world` / `effects.phase` 切换，用条件变量 `#world` / `#phase` 改变可见行动。只在状态级写外观差异，不要逐节点复制，也不要把关键选项藏进 CSS；详见仓库 `docs/world-state.md`；
- **好感度**：普通数值变量（`add`/`set` 维护），`story_set_meta { hud: [{ var: "好感度", label: "好感度", max: 100 }] }` 显示进度条；HUD 支持 `var: "#day"` 显示天数；
- **成就**：`{ id, title, description, icon?, hidden?, when }`，`when` 支持特殊变量；
- **线索/文档**：`story_upsert_document { document: { id, title, text, kind } }` 定义，节点用 `effects.gainDocs: ["d_id"]` 收集，玩家可在线索夹查看；条件 `#docs` 判断是否已获得；
- **文本块/受控富文本**：`blocks` 可代替 `text` 的**渲染内容**做混合排版，但节点 schema 中 `text` 仍是必填字符串；使用 blocks 时同时提供简短纯文本回退。块格式：`{ type: "title"|"para"|"rules"|"note"|"letter", text, title?, segments? }`。需要血字、终端、电视色块、条件遮挡或乱码时读取 `references/rich-text.md`；不要生成 HTML/CSS；
- **目标与教学**：节点 `objective` 显示当前目标；推理板、人物关系、场景谜题首次出现时运行时自动教学；`Deduction.hint` 只给调查方向，不泄露所缺证据名称；
- **主题**：`story_set_meta { theme: "dark"|"cyber"|"cozy"|"paper" }` 或自定义配色对象 `{ accent, card, background, ... }`。
- **视觉表达**：`story_set_presentation { presentation: { shell, typography, density, shape, choiceStyle } }`。五项均可省略，默认 `novel/literary/balanced/soft/buttons`；节点可用同结构的 `presentation` 覆盖差异项。

## 视觉导演与 Token 效率

颜色不是作品风格的全部。写剧情前先用不超过 5 句话确定：玩家面对的媒介、主要构图、字体性格、选项隐喻、唯一动态母题。然后从下列短枚举选择一次全局配方：

| 维度 | 可选值 | 用途 |
|---|---|---|
| `shell` | `novel` / `dossier` / `chat` / `cinematic` | 小说阅读 / 调查档案 / 通讯对话 / 全屏字幕舞台 |
| `typography` | `literary` / `modern` / `mono` / `rounded` | 文学 / 当代 / 终端 / 亲和 |
| `density` | `compact` / `balanced` / `spacious` | 信息密度 |
| `shape` | `sharp` / `soft` / `round` | 几何性格 |
| `choiceStyle` | `buttons` / `list` / `dialogue` / `commands` | 按钮 / 行动目录 / 玩家对白 / 命令行 |

推荐配方示例：

```jsonc
// 社区悬疑档案
{ "shell": "dossier", "typography": "mono", "density": "compact", "shape": "sharp", "choiceStyle": "list" }

// 人物关系短信剧
{ "shell": "chat", "typography": "rounded", "density": "compact", "shape": "round", "choiceStyle": "dialogue" }

// 大银幕式惊悚
{ "shell": "cinematic", "typography": "modern", "density": "spacious", "shape": "sharp", "choiceStyle": "buttons" }
```

Token 使用原则：

- 全局配方只调用一次，不为每个节点重复；节点覆盖只写变化项，例如 `{ "shell": "cinematic", "density": "spacious" }`；
- 不输出自定义 CSS，不反复描述同一视觉意图；用枚举表达，交给运行时展开；
- 大批节点先分批规划 id、目标和转移，再用 MCP 写入；校验放在一批写完后，而不是每写一个节点都读取全量 story；
- `story_get` 返回全量 JSON，只在确实需要全局数据时调用；局部修稿用 `story_get_node`，连续性审查用分页的 `story_review_transitions`，单选项修改用 `story_patch_choice`；
- 同一 `presentation` 在 3 个以上节点重复会产生体验警告，应提升到全局；
- 创作自由优先用于媒介、构图和叙事节奏，不把 token 消耗在逐节点换色或同义视觉说明上。

## 题材 → 配置映射

| 用户需求 | 引擎配置 |
|---|---|
| 悬疑/恐怖 | `theme: "dark"`；变量：理智值/线索数；成就：结局收集 |
| 调查/推理 | 先写真相和人物动机；`evidence` 分布到场景，`deductions` 定义公平证据链，`#deduction` 解锁质问与结局 |
| 规则怪谈 | `documents` 多份矛盾守则 + `gainDocs` 收集 + `blocks` 规则排版 + `#docs` 条件解锁；`violation`/`#violated` 违规度、`day`/`#day` 天数循环、节点 `sfx`/`fx` 恐怖氛围，结局按违规度分支 |
| 赛博/科幻 | `theme: "cyber"`；变量：信用点/黑客等级 |
| 温馨/恋爱 | `theme: "cozy"`；`hud` 显示好感度进度条；成就：隐藏好感事件 |
| 人物关系 | 为人物定义少量有意义的关系维度；关系变化配套 `remember`，达到门槛后揭示秘密、证据或新行动 |
| 解谜 | `puzzles` 定义可由游戏内信息推出的密码和渐进提示；`onSolved` 发放证据或效果，`#puzzle` 解锁后续 |
| 复古/蒸汽 | `theme: "paper"` |
| RPG 冒险 | 道具 `gain`/`lose` + 数值变量 + `when` 条件解锁选项 |
| 收集/多结局 | `achievements` 按 `#ending`/`#visited` 条件收集 |

## 按需参考

- 悬疑、证据、推论或结局指控：创作前读取 `references/mystery-design.md`；
- 开放 hub、重复探索、推论/谜题较多，或 walk 超过 10,000 状态：读取 `references/walk-performance.md`；
- 导出前运行时验收：读取 `references/runtime-testing.md`。
- 正文较多、人物声音重要、用户要求降低 AI 味，或多个选择汇入同一节点：读取 `references/prose-and-transitions.md`。

不要在无关题材中读取全部参考；主 Skill 提供通用契约，参考文件只在触发条件满足时加载，以减少固定上下文和重复说明。

## 注意事项

- 推理作品必须保证正确结论能从游戏内证据推出；误导应有可发现的反证；关键证据尽量有替代获取路径；
- 不要用普通 `flag` 冒充证据和推论：玩家拿到文档、掌握证据、确认推论是三个不同状态；
- 关键机制不能只藏在顶部工具入口；调查中心、谜题现场和结案阶段应有 `objective`，获得证据后应能从主要行动进入推理板；
- 不要只修改关系数值却不改变任何内容；关系应影响信息、选择、秘密或结局，记忆负责说明“为什么”；
- 谜题答案必须能从游戏内信息推出；提示从轻到重；关键谜题必须允许玩家返回搜证，不能永久锁死；
- 新谜题必须写清 `actionLabel` 并通过节点 `puzzles: [id]` 放进具体场景；不要依赖顶部“谜题”工具入口；谜题场景还应提供至少一个调查或转场行动；

- 结局节点 `choices` 必须为空且带 `ending`；`upsert` 会自动登记结局到结局表；
- 所有选项 `target` 必须指向存在的节点；`story_validate` 会报告断链、不可达节点、变量拼写错误；
- 删除节点若被引用会报错，`force: true` 可强删但会产生断链——删完必须 `story_validate` 复核；
- `story_export` 在校验不过时会拒绝导出，先修校验；
- 正文/文案中的 `{未写入变量}` 会被校验报告（通常是拼写错误）。
- Windows 下不要用可能写入 UTF-8 BOM 的方式手工修复 `story.json`；优先通过 MCP 工具修改。若确需脚本修复，用 Node 的 `fs.writeFile(..., 'utf8')` 并在覆盖前备份。
