---
name: ai-text-engine
description: 用 ai-text-engine 的 MCP 工具制作 HTML 互动叙事游戏。当用户想体验文字冒险、互动小说、分支故事、悬疑调查、证据推理或轻量解谜时使用。理解用户想要的体验，完善剧情设计，通过 story_ 工具构建并导出可直接游玩的单文件 HTML。
---

# ai-text-engine · 给 AI 的文字冒险引擎

通过 MCP 服务器 `ai-text-engine` 用工具构建文字冒险游戏，最终交付一个**自包含单文件 HTML**（双击即玩、可发任何人、零依赖）。剧情是纯 JSON 数据，无需写代码。

前置条件：AI 客户端已连接 `ai-text-engine` MCP 服务器（工具名以 `story_` 开头）。

## 工具速览

| 工具 | 用途 |
|---|---|
| `story_new` | 创建项目（自动生成 start + 示例结局骨架） |
| `story_get` | 读取完整剧情 JSON |
| `story_upsert_node` | 创建/覆盖节点（结局自动登记到结局表） |
| `story_delete_node` | 删除节点（被引用时需 `force: true`） |
| `story_delete_ending` | 删除结局定义 |
| `story_upsert_achievement` / `story_delete_achievement` | 管理成就 |
| `story_upsert_document` / `story_delete_document` | 管理线索/文档（规则守则/便条/信件） |
| `story_upsert_evidence` / `story_delete_evidence` | 管理可用于推理的证据 |
| `story_upsert_deduction` / `story_delete_deduction` | 管理证据组合推论 |
| `story_upsert_character` / `story_delete_character` | 管理人物、关系维度与秘密 |
| `story_set_meta` | 主题 / HUD 统计条 / 副标题 / 作者 |
| `story_validate` | 校验 + 路径探索模拟（结局覆盖统计） |
| `story_walk` | 路径探索模拟（各结局路径数 / 最短步数） |
| `story_graph` | mermaid 分支图 |
| `story_export` | 导出单文件 HTML（校验不过会拒绝） |
| `story_list` / `story_delete_project` | 项目管理 |

## 标准工作流

### 先理解体验

不要收到需求后立刻写节点。先提炼：玩家身份、核心幻想、氛围、期望情绪、玩法重点、时长、难度和结局风格。只有缺失信息会实质改变作品时才追问；否则采用合理默认值继续。

悬疑/推理作品必须先确定真实事件、人物动机与隐瞒，再设计证据和推论，最后安排场景。不能先写场景、最后临时决定真相。

1. **建项目**：`story_new { title, subtitle? }` —— 标题即项目名，之后所有工具用它定位。
2. **清骨架**：`story_delete_node { nodeId: 'end', force: true }` 再 `story_delete_ending { endingId: 'e_end' }`
   （或直接用 `story_upsert_node` 覆盖 start 节点）。
3. **写节点**：`story_upsert_node { node }` 逐个写入。先全部写完再校验——中途断链是正常的。
4. **设风格/数值**（按需）：`story_set_meta { theme, hud }`；`story_upsert_achievement { achievement }`。
5. **推理设计**（按需）：先用 `story_upsert_evidence` 定义证据，再用 `story_upsert_deduction` 定义证据要求；节点用 `gainEvidence` 发放证据，用 `#deduction` 解锁新内容。
6. **人物关系**（按需）：用 `story_upsert_character` 定义人物、关系维度和秘密；关系变化同时写入 `remember`，秘密揭示应影响证据、对话或结局。
7. **校验与走查**：`story_validate { title }` —— 通过且 `unreachableEndings` 为空、`walk.endings` 覆盖全部结局后再导出。可以用 `story_graph` 生成 mermaid 审查分支结构。
8. **导出交付**：`story_export { title }`，把返回的 `outputPath`（`projects/<标题>/dist/index.html`）交给用户。

## 节点数据格式速查

```jsonc
{
  "id": "node_id",                 // 唯一
  "text": "正文，{var} 插值，{#inventory} 道具列表，\\n 换行",
  "choices": [
    {
      "label": "选项文案",
      "target": "下一节点 id",
      "when": { "op": "gte", "var": "好感度", "value": 60 },  // 可选：显示条件
      "effects": { "add": { "好感度": 10 }, "gain": ["钥匙"] } // 可选：选择后生效
    }
  ],
  "ending": { "id": "e_1", "title": "结局标题", "kind": "good" }, // 结局节点：choices 为空且必带
  "onEnter": { "set": { "flag": true } }                        // 可选：进入节点生效
}
```

- **效果** `Effects`：`set`（赋值）/ `add`（数值增减）/ `rand`（随机整数，`[{var,min,max}]`）/ `violation`（记录违规规则）/ `day`（推进天数）/ `gain` / `lose`（道具）/ `gainDocs`（文档）/ `gainEvidence`（推理证据）/ `flag`（旗标，与变量同命名空间）；
- **人物效果**：`adjustRelation: [{characterId, stat, add}]` 调整关系；`remember` 记录玩家关键行为；`revealSecrets: ['角色:秘密']` 揭示秘密；
- **条件** `Condition`：`op: eq|ne|gt|gte|lt|lte|exists|has|not_has`，可组合 `and` / `or` / `not`；
  `has`/`not_has` 检查道具；特殊变量 `#steps` / `#ending` / `#visited` / `#docs` / `#evidence` / `#deduction` / `#day`（天数）/ `#violated`（违反过某规则）；
- **音效/动画**：节点 `sfx`（click/page/heartbeat/drone/achievement/shock/ending_*）与 `fx`（shake/flicker/glitch/pulse/**unstable**，可带参数 `{name, intensity?, speed?}` 调幅度/频率；unstable=随机间隔连闪爆发，模拟坏灯）；选项/成就/线索/结局自动播音效，右上角 🔊 可静音；
- **好感度**：普通数值变量（`add`/`set` 维护），`story_set_meta { hud: [{ var: "好感度", label: "好感度", max: 100 }] }` 显示进度条；HUD 支持 `var: "#day"` 显示天数；
- **成就**：`{ id, title, description, icon?, hidden?, when }`，`when` 支持特殊变量；
- **线索/文档**：`story_upsert_document { document: { id, title, text, kind } }` 定义，节点用 `effects.gainDocs: ["d_id"]` 收集，玩家可在线索夹查看；条件 `#docs` 判断是否已获得；
- **文本块**：节点可用 `blocks` 代替 `text` 混合排版：`{ type: "title"|"para"|"rules"|"note"|"letter", text, title? }` —— 规则怪谈的多份守则/便条就靠它；
- **主题**：`story_set_meta { theme: "dark"|"cyber"|"cozy"|"paper" }` 或自定义配色对象 `{ accent, card, background, ... }`。

## 题材 → 配置映射

| 用户需求 | 引擎配置 |
|---|---|
| 悬疑/恐怖 | `theme: "dark"`；变量：理智值/线索数；成就：结局收集 |
| 调查/推理 | 先写真相和人物动机；`evidence` 分布到场景，`deductions` 定义公平证据链，`#deduction` 解锁质问与结局 |
| 规则怪谈 | `documents` 多份矛盾守则 + `gainDocs` 收集 + `blocks` 规则排版 + `#docs` 条件解锁；`violation`/`#violated` 违规度、`day`/`#day` 天数循环、节点 `sfx`/`fx` 恐怖氛围，结局按违规度分支 |
| 赛博/科幻 | `theme: "cyber"`；变量：信用点/黑客等级 |
| 温馨/恋爱 | `theme: "cozy"`；`hud` 显示好感度进度条；成就：隐藏好感事件 |
| 人物关系 | 为人物定义少量有意义的关系维度；关系变化配套 `remember`，达到门槛后揭示秘密、证据或新行动 |
| 复古/蒸汽 | `theme: "paper"` |
| RPG 冒险 | 道具 `gain`/`lose` + 数值变量 + `when` 条件解锁选项 |
| 收集/多结局 | `achievements` 按 `#ending`/`#visited` 条件收集 |

## 注意事项

- 推理作品必须保证正确结论能从游戏内证据推出；误导应有可发现的反证；关键证据尽量有替代获取路径；
- 不要用普通 `flag` 冒充证据和推论：玩家拿到文档、掌握证据、确认推论是三个不同状态；
- 不要只修改关系数值却不改变任何内容；关系应影响信息、选择、秘密或结局，记忆负责说明“为什么”；

- 结局节点 `choices` 必须为空且带 `ending`；`upsert` 会自动登记结局到结局表；
- 所有选项 `target` 必须指向存在的节点；`story_validate` 会报告断链、不可达节点、变量拼写错误；
- 删除节点若被引用会报错，`force: true` 可强删但会产生断链——删完必须 `story_validate` 复核；
- `story_export` 在校验不过时会拒绝导出，先修校验；
- 正文/文案中的 `{未写入变量}` 会被校验报告（通常是拼写错误）。
