---
name: ai-text-engine
description: 用 ai-text-engine 的 MCP 工具制作 HTML 文字冒险游戏。当用户说「帮我做一个文字冒险/互动小说/选择游戏」「写一个分支剧情游戏」时使用。通过 MCP 工具（story_new / story_upsert_node / story_validate / story_export 等）从零构建剧情并导出可直接游玩的单文件 HTML。
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
| `story_set_meta` | 主题 / HUD 统计条 / 副标题 / 作者 |
| `story_validate` | 校验 + 全路径模拟（结局覆盖统计） |
| `story_walk` | 全路径模拟（各结局路径数 / 最短步数） |
| `story_graph` | mermaid 分支图 |
| `story_export` | 导出单文件 HTML（校验不过会拒绝） |
| `story_list` / `story_delete_project` | 项目管理 |

## 标准工作流

1. **建项目**：`story_new { title, subtitle? }` —— 标题即项目名，之后所有工具用它定位。
2. **清骨架**：`story_delete_node { nodeId: 'end', force: true }` 再 `story_delete_ending { endingId: 'e_end' }`
   （或直接用 `story_upsert_node` 覆盖 start 节点）。
3. **写节点**：`story_upsert_node { node }` 逐个写入。先全部写完再校验——中途断链是正常的。
4. **设风格/数值**（按需）：`story_set_meta { theme, hud }`；`story_upsert_achievement { achievement }`。
5. **校验与走查**：`story_validate { title }` —— 通过且 `unreachableEndings` 为空、`walk.endings` 覆盖全部结局后再导出。可以用 `story_graph` 生成 mermaid 审查分支结构。
6. **导出交付**：`story_export { title }`，把返回的 `outputPath`（`projects/<标题>/dist/index.html`）交给用户。

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

- **效果** `Effects`：`set`（赋值）/ `add`（数值增减）/ `rand`（随机整数，`[{var,min,max}]`）/ `violation`（记录违规规则）/ `day`（推进天数）/ `gain` / `lose`（道具）/ `gainDocs`（线索）/ `flag`（旗标，与变量同命名空间）；
- **条件** `Condition`：`op: eq|ne|gt|gte|lt|lte|exists|has|not_has`，可组合 `and` / `or` / `not`；
  `has`/`not_has` 检查道具；特殊变量 `#steps` / `#ending` / `#visited` / `#docs` / `#day`（天数）/ `#violated`（违反过某规则）；
- **音效/动画**：节点 `sfx`（click/page/heartbeat/drone/achievement/shock/ending_*）与 `fx`（shake/flicker/glitch/pulse）；选项/成就/线索/结局自动播音效，右上角 🔊 可静音；
- **好感度**：普通数值变量（`add`/`set` 维护），`story_set_meta { hud: [{ var: "好感度", label: "好感度", max: 100 }] }` 显示进度条；HUD 支持 `var: "#day"` 显示天数；
- **成就**：`{ id, title, description, icon?, hidden?, when }`，`when` 支持特殊变量；
- **线索/文档**：`story_upsert_document { document: { id, title, text, kind } }` 定义，节点用 `effects.gainDocs: ["d_id"]` 收集，玩家可在线索夹查看；条件 `#docs` 判断是否已获得；
- **文本块**：节点可用 `blocks` 代替 `text` 混合排版：`{ type: "title"|"para"|"rules"|"note"|"letter", text, title? }` —— 规则怪谈的多份守则/便条就靠它；
- **主题**：`story_set_meta { theme: "dark"|"cyber"|"cozy"|"paper" }` 或自定义配色对象 `{ accent, card, background, ... }`。

## 题材 → 配置映射

| 用户需求 | 引擎配置 |
|---|---|
| 悬疑/恐怖 | `theme: "dark"`；变量：理智值/线索数；成就：结局收集 |
| 规则怪谈 | `documents` 多份矛盾守则 + `gainDocs` 收集 + `blocks` 规则排版 + `#docs` 条件解锁；`violation`/`#violated` 违规度、`day`/`#day` 天数循环、节点 `sfx`/`fx` 恐怖氛围，结局按违规度分支 |
| 赛博/科幻 | `theme: "cyber"`；变量：信用点/黑客等级 |
| 温馨/恋爱 | `theme: "cozy"`；`hud` 显示好感度进度条；成就：隐藏好感事件 |
| 复古/蒸汽 | `theme: "paper"` |
| RPG 冒险 | 道具 `gain`/`lose` + 数值变量 + `when` 条件解锁选项 |
| 收集/多结局 | `achievements` 按 `#ending`/`#visited` 条件收集 |

## 注意事项

- 结局节点 `choices` 必须为空且带 `ending`；`upsert` 会自动登记结局到结局表；
- 所有选项 `target` 必须指向存在的节点；`story_validate` 会报告断链、不可达节点、变量拼写错误；
- 删除节点若被引用会报错，`force: true` 可强删但会产生断链——删完必须 `story_validate` 复核；
- `story_export` 在校验不过时会拒绝导出，先修校验；
- 正文/文案中的 `{未写入变量}` 会被校验报告（通常是拼写错误）。
