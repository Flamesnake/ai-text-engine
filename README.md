# ai-text-engine · 给 AI 用的文字冒险引擎 + MCP 服务器

让 AI（Claude / Cursor / 任何支持 MCP 的 agent）通过 **MCP 工具**创建、编辑、校验并导出
**单文件 HTML 文字冒险游戏**的引擎。

- **剧情 = 纯 JSON 数据**：AI 用工具增删节点，无需写代码；
- **通用机制**：变量 / 道具 / 旗标 / 条件选项 / 节点进入效果，够做悬疑、RPG、怪谈等题材；
- **单文件导出**：`story_export` 产出一个自包含 `index.html`，双击即玩、可发任何人、零依赖；
- **质量闭环**：静态校验、结局见证、失败路线、DOM 重放与体验评估共同发现结构和交互问题；
- **推理与演出**：内置证据、推论、谜题、人物关系、受控富文本和轻量声画效果；
- **宿主无关**：核心是普通 Node.js + MCP 服务，未来可以通过薄适配层接入不同 Agent Harness。

## 安装与分发状态

当前版本仍采用**源码安装**，尚未发布到 npm，也没有要求用户安装 DeepSeek Harness。完成 npm 发布准备后，目标是让 MCP 客户端通过 `npx` 直接启动，并另行提供可选的 DSH 薄适配包；在正式发布前，README 不会展示尚不可用的安装命令。

`projects/` 是本地创作区，已被 Git 整体忽略：其中的 `story.json`、导出 HTML 和个人作品不会随源码仓库提交，也不会进入未来的 npm 包。仓库只保留明确设计为公开测试夹具的 `examples/` 和构建样板。发布前还会通过 npm `files` 白名单只打包运行时、CLI、Skill 和必要文档。

## 快速开始

> 配套 AI skill 源文件位于 `skill/SKILL.md`。客户端实际加载的通常是用户技能目录中的已安装副本；修改仓库源文件后需要重新同步/安装，不能假定两者自动一致。

```bash
npm install          # 安装依赖
npm run build        # 编译到 dist/（tsc）+ 打包运行时（esbuild）
npm test             # 运行 vitest 测试
npm run mcp          # 以 stdio 方式启动 MCP 服务器
npm run check:release # 发布前：构建 + 测试 + MCP 握手 + 项目语料校验
```

> `npm run check:release` 会读取本机 `projects/` 做兼容性回归，但不会复制、修改或上传作品。

### 注册到 AI 客户端

在 AI 客户端的 MCP 配置中注册本服务器。不同客户端读取的配置位置不同，仓库根目录的 `.mcp.json` **不能证明 Codex 已经注册该服务器**。

#### Codex / ChatGPT 桌面端

Codex 默认读取用户级 `~/.codex/config.toml`，可信项目也可以使用项目内 `.codex/config.toml`。最稳妥的注册方式是：

```bash
codex mcp add ai-text-engine -- node E:/GAMER/wzkb/ai-text-engine/dist/mcp/server.js
```

也可以在设置中的 **MCP servers → Add server** 添加同一条 STDIO 命令，或在 `config.toml` 中写入：

```toml
[mcp_servers."ai-text-engine"]
command = "node"
args = ["E:/GAMER/wzkb/ai-text-engine/dist/mcp/server.js"]
enabled = true
```

保存后选择 Restart，或完全退出并重新打开客户端；在任务中用 `/mcp` 检查连接状态。

#### 其他 MCP 客户端

Claude Desktop、Cursor 等使用 JSON 配置的客户端可采用：

```json
{
  "mcpServers": {
    "ai-text-engine": {
      "command": "node",
      "args": ["C:/path/to/ai-text-engine/dist/mcp/server.js"]
    }
  }
}
```

> 把示例路径换成你 clone 后的实际路径（Windows 用正斜杠或转义反斜杠）。

注册前先执行 `npm run build`，确保 `dist/mcp/server.js` 已生成；修改 MCP 配置后通常需要重启或刷新客户端会话。Skill 已加载但看不到 `story_` 工具时，说明 MCP 并未连接。

### 验证

```bash
node scripts/verify-mcp.mjs      # stdio 握手 + 工具清单（应输出 VERIFY OK）
node scripts/demo.mjs            # 端到端演示：AI 全流程构建《迷雾车站》并导出
node scripts/verify-export.mjs   # 验证导出 HTML 内嵌剧情可玩
node scripts/build-integrated-mystery.mjs   # 通过 MCP 构建综合悬疑样板《雨夜遗嘱》
node scripts/verify-integrated-mystery.mjs  # 实际操作运行时，验收完整真相路线
```

第一轮 Agent 泛化盲测题见 `docs/evals/blind-prompts.md`；隐藏评分表见 `docs/evals/evaluation-rubric.md`。生成 Agent 只能看到题目，不能看到评分表。

产品核心的近期与远期路线、阶段依赖、暂不做事项和质量门槛见
[`docs/product-roadmap.md`](docs/product-roadmap.md)。当前正在完成首个“插件就绪”版本：质量闭环、严格声画契约、
受控富文本、部署诊断与版本发布；叙事声景、世界状态、拟态网页、受控空间和 Meta 叙事不作为首个插件前置条件。
插件封装边界和发布清单见 [`docs/plugin-readiness.md`](docs/plugin-readiness.md)。
文字、媒介、空间与远期 3D 能力的产品边界见
[`docs/narrative-freedom.md`](docs/narrative-freedom.md)：所有自由度必须服务文字冒险体验，并保持结构化、可校验和可降级。

## MCP 工具

| 工具 | 用途 |
|---|---|
| `story_new` | 创建项目（写 `projects/<标题>/story.json` 骨架）；已存在则复用 |
| `story_get` | 读取整个剧情 JSON |
| `story_upsert_node` | 创建/覆盖节点（结局自动登记到结局表） |
| `story_delete_node` | 删除节点（有引用时需 `force: true`，会报告断链） |
| `story_delete_ending` | 从结局表删除结局（被节点使用时拒绝） |
| `story_upsert_achievement` / `story_delete_achievement` | 添加/删除成就定义 |
| `story_upsert_document` / `story_delete_document` | 添加/删除线索/文档（规则守则/便条/信件，可被收集查看） |
| `story_upsert_evidence` / `story_delete_evidence` | 添加/删除可用于推理的证据 |
| `story_upsert_deduction` / `story_delete_deduction` | 添加/删除证据组合推论 |
| `story_upsert_character` / `story_delete_character` | 添加/删除包含关系维度与秘密的人物 |
| `story_upsert_puzzle` / `story_delete_puzzle` | 添加/删除密码谜题、渐进提示与成功效果 |
| `story_validate` | 校验 + 路径探索模拟（结局覆盖统计） |
| `story_evaluate` | 作品体验评估：互动、机制、演出、重复导航与 walk 健康度；不打总分 |
| `story_walk` | 结局见证与覆盖诊断（可重放路径 / 预算占用 / 热点节点；可调 `maxStates` 等参数） |
| `story_graph` | 生成 mermaid 分支图（审查结构用） |
| `story_export` | 导出单文件 HTML（校验不通过时拒绝） |
| `story_set_meta` | 更新副标题 / 作者 / **主题** / **HUD 统计条** |
| `story_set_presentation` | 设置 `novel/dossier/chat/cinematic` 外壳与字体、密度、形状、选项风格 |
| `story_list` | 列出所有项目 |
| `story_delete_project` | 删除整个项目 |
| `story_observability` / `story_observability_reset` | 查看/清零本地 MCP 成本摘要（调用、字节、粗略 token、耗时、重复覆盖） |

项目数据存放在 `projects/<标题>/story.json`，导出物在 `projects/<标题>/dist/index.html`。

复杂开放结构可调用
`story_walk { title, diagnostics: true, topNodes: 10, maxStates?: 100000, witnessMaxStates?: 25000 }`。
`reachability` 为每个已证明可达的结局返回一条可重放 `witness`；`failures.witnesses` 返回已经找到的
条件软锁与无结局终点路线，`failures.complete` 表示失败搜索是否完整。即使全量探索超出
`maxStates`，walker 也会在每个缺失结局上追加一次目标导向搜索。`coverage.complete` 单独表示
全状态覆盖是否完成，`coverage.reasons` 说明受限原因，`budget.utilization` 与 `hotNodes` 用来定位
高频 hub/回环。兼容字段 `truncated` 只表示主探索耗尽全局状态预算，不再等同于“结局不可达”。
构建后可用 `node scripts/verify-walk-witnesses.mjs "作品名"` 在真实 `Game` 中批量重放这些见证；
再用 `node scripts/verify-dom-witnesses.mjs "作品名"` 自动操作真实运行时的选项、推理板、谜题输入与返回按钮，并确认失败见证确实会把玩家锁住；发现失败路径时命令以非零状态退出。
两者都不会评价谜题公平性、文案提示和演出节奏，不能完全替代人工试玩。

导出前可调用 `story_evaluate { title }` 集中检查作品。它返回事实指标与带证据的候选问题，
包括无状态自循环、重复选择结果和未回收的证据/推论/谜题；不输出总分，也不会因题材未采用谜题或人物关系而机械告警。第一轮校准基线见
[`docs/evals/evaluation-baseline.md`](docs/evals/evaluation-baseline.md)。

盲测前调用 `story_observability_reset {}`，完成后调用 `story_observability {}`，可得到本次 MCP
进程内的调用次数、失败、请求/响应字节、粗略 token、耗时、全量读取、walk、导出和重复覆盖摘要。
摘要只保留聚合数字与资源 id，不记录剧情正文，也不等同于模型平台账单。

## 剧情数据格式

```ts
interface Story {
  meta: { title: string; subtitle?: string; version?: string; author?: string }
  start: string                                // 起始节点 id
  nodes: Record<string, StoryNode>             // 节点表
  endings: Record<string, EndingMeta>          // 结局表（upsert 节点时自动登记）
}

interface StoryNode {
  id: string
  text: string                    // 正文；支持 {varName} 插值、{#inventory} 道具列表、\n 换行
  choices: Choice[]               // 空数组 = 结局节点（必须带 ending）
  ending?: EndingMeta             // { id, title, kind: 'good'|'bad'|'true'|'hidden' }
  onEnter?: Effects               // 进入本节点时生效
  tags?: string[]                 // 仅供 AI/作者管理，不影响游戏
  note?: string                   // 设计备注，不进入游戏
}

interface Choice {
  label: string                   // 按钮文案（支持 {var} 插值）
  target: string                  // 目标节点 id
  when?: Condition                // 显示条件（不满足则选项隐藏）
  effects?: Effects               // 选择后生效
}

interface Effects {
  set?: Record<string, number | string | boolean>  // 赋值变量
  add?: Record<string, number>                     // 数值增减（不存在时从 0 起算）
  rand?: { var: string; min: number; max: number }[] // 随机赋整数（含两端）
  violation?: string[]                             // 记录违规规则 id（去重，条件 #violated）
  day?: number                                     // 推进天数（增量；最小 1）
  gain?: string[]                                  // 获得道具
  lose?: string[]                                  // 失去道具
  gainDocs?: string[]                              // 获得线索/文档
  gainEvidence?: string[]                          // 获得推理证据
  adjustRelation?: { characterId: string; stat: string; add: number }[]
  remember?: string[]                              // 记录关键行为记忆
  revealSecrets?: string[]                         // 揭示秘密（characterId:secretId）
  flag?: Record<string, boolean>                   // 旗标（与变量同命名空间）
}

interface Condition {
  var?: string
  op?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'exists' | 'has' | 'not_has'
  value?: number | string | boolean
  and?: Condition[]
  or?: Condition[]
  not?: Condition
}
```

要点：

- 条件 `has` / `not_has`：普通 `var` 视为**道具名**并检查 `inventory`；对于 `#visited`、`#docs`、`#evidence`、`#deduction`、`#violated`、`#memory`、`#secret`、`#puzzle` 等集合型特殊变量，`value` 是要检查的 id；集合变量同时兼容既有 `eq` / `ne` 写法；
- 条件 `exists`：检查变量是否已定义；其余比较符与 `vars[var]` 比较；
- **旗标与变量同命名空间**（`flag` 效果写进 `vars`），条件可直接引用；
- **特殊变量**：`#steps`（步数）、`#ending`（结局 id）、`#visited`（访问过某节点）、
  `#docs`（获得过某文档）、`#evidence`（获得过某证据）、`#deduction`（已确认某推论）、
  `#day`（当前天数，数值比较）、`#violated`（违反过某规则，eq 判断）；
- 结局节点：`choices: []` 且带 `ending`；选项的 `target` 必须指向存在的节点；
- 正文/选项文案中的 `{未写入变量}` 会被 `story_validate` 报告（疑似拼写错误）；
- 正文插值还支持 `{#day}`（显示天数）。

## 音效 / 动画

节点可声明氛围效果（`story_upsert_node` 时带上）：

```jsonc
{
  "id": "dark_hall",
  "text": "走廊尽头一片漆黑……",
  "sfx": "heartbeat",          // 严格枚举；未知音效在写入时拒绝
  "fx": ["flicker"],           // 卡片动画：shake / flicker / glitch / pulse
  "onEnter": { "day": 1, "violation": ["r_curfew"], "rand": [{ "var": "恐惧", "min": 1, "max": 5 }] }
}
```

- **音效**（Web Audio 程序化合成，零外部文件）：`click`（选项）、`page`（线索翻页）、
  `heartbeat`（心跳）、`drone`（低频氛围）、`achievement`（成就）、`shock`（惊吓）、
  `ending_good` / `ending_bad` / `ending_true` / `ending_hidden`（结局）；
- 选项点击、成就解锁、线索翻页、结局自动播放对应音效；标题屏/游戏画面右上角 🔊 按钮可静音（偏好持久化）；
- **动画**（可调幅度/频率）：`shake` 抖动 / `flicker` 持续闪烁 / `glitch` 毛刺 / `pulse` 脉动 /
  `unstable` 不稳定灯（**随机间隔连闪爆发**，模拟坏灯）；支持带参数规格
  `{ name, intensity?, speed? }`——`intensity` 幅度倍率范围 `0.1..2`（0.3=轻微，2=剧烈）、
  `speed` 频率倍率范围 `0.25..4`（2=快一倍，0.5=慢一倍），默认 1（即原版参数）；越界值在写入时拒绝；
- 例如「不稳定的灯」：`"fx": [{ "name": "unstable", "intensity": 0.6, "speed": 1 }]`（大部分时间正常，随机 2-5 秒触发一次连闪两三下，再安静一阵）；
- 尊重系统「减弱动态效果」设置。

## 受控富文本

文本块可用 `segments` 混排强调、斜体、血字、耳语、终端、手写、电视色块，以及条件遮挡/乱码。节点与文本块的 `text` 仍是必填纯文本回退；不接受任意 HTML/CSS。

```jsonc
{
  "type": "para",
  "text": "病历写着：凌晨三点。",
  "segments": [
    { "text": "病历写着：" },
    {
      "text": "凌晨三点",
      "style": "redacted",
      "revealWhen": { "op": "eq", "var": "#evidence", "value": "e_真实时间" }
    },
    { "text": "。血迹未干。", "style": "blood" }
  ]
}
```

允许样式：`emphasis`、`italic`、`blood`、`whisper`、`redacted`、`glitch`、`corrupt`、`terminal`、`handwritten`、`broadcast`。条件引用会参与静态校验；未揭示的真实文本不会写入页面 DOM。创作规范见 [`skill/references/rich-text.md`](skill/references/rich-text.md)。

## 规则怪谈玩法配方（违规度 + 天数循环）

- **违规度**：违反规则处加 `violation: ["r_xxx"]`；条件 `#violated` 判断是否违反过（解锁后续分支）；
- **天数循环**：过夜节点 `onEnter: { day: 1 }`；HUD 显示天数：`story_set_meta { hud: [{ var: "#day", label: "第几天", max: 7 }] }`；
- **随机性**：`rand` 效果产生浮动值（伤害/掉宝/随机事件）；成就/条件可直接引用生成的变量。

## 成就 / 主题 / HUD

**成就**（`Story.achievements`，用 `story_upsert_achievement` 管理）：

```ts
interface Achievement {
  id: string
  title: string
  description: string
  icon?: string          // emoji
  hidden?: boolean       // 解锁前在列表显示「？？？」（隐藏成就）
  when: Condition        // 达成条件；特殊变量 #steps（步数）/ #ending（结局 id）/ #visited（访问过某节点）
}
```

解锁后游戏中弹 toast，标题屏「成就」入口查看列表；解锁记录随存档保存。

**主题**（`Story.meta.theme`，用 `story_set_meta { theme }`）：

- 内置：`dark`（悬疑）/ `cyber`（霓虹）/ `cozy`（温馨浅色）/ `paper`（复古纸页）；
- 自定义：传配色对象 `{ background, card, border, borderGlow, text, textDim, accent, danger, gold, green, purple }`；
- 未知主题名导出时自动回退 `dark`。

**HUD 统计条**（`Story.meta.hud`，好感度/理智值等数值变量的可视化）：

```ts
{ var: '好感度', label: '好感度', max: 100 }   // max 为进度条满值
```

游戏画面顶部显示进度条与数值；配合 `effects.add` 即可实现好感度系统（普通数值变量语义不变）。

## 文档 / 线索系统（规则怪谈核心载体）

**线索/文档**（`Story.documents`，用 `story_upsert_document` 管理）：

```ts
interface StoryDocument {
  id: string
  title: string
  kind?: 'rules' | 'note' | 'letter' | 'doc'   // 守则 / 便条 / 信 / 文档
  text: string                                  // 正文（支持 {var} 插值）
}
```

- 节点/选项用 `effects.gainDocs: ['d_id']` 让玩家**收集线索**（进线索夹，不进道具栏）；
- 游戏画面右上角出现「线索 N」按钮 → 线索夹列表 → 点开查看正文（按 kind 排版）；
- 条件可用 `#docs`：`{ op: 'eq', var: '#docs', value: 'd_id' }` 判断是否已获得某线索（用于解锁后续选项/成就）。

**文本块**（`StoryNode.blocks`，存在时优先于 `text` 渲染，适合同一节点混合排版）：

```ts
blocks: [
  { type: 'title', title: '雾中车站', text: '雾中车站' },
  { type: 'para', text: '凌晨一点半，雾把车站裹成一只茧……' },
  { type: 'rules', title: '售票窗口告示', text: '1. 末班车 23:00 发车。\n2. 雾天禁止在站台逗留。' },
  { type: 'note', text: '（纸条，字迹潦草）' },
]
```

块类型：`title` 标题 / `para` 段落 / `rules` 规则清单（等宽金字）/ `note` 便条（斜体灰）/ `letter` 信件。
配合线索夹，即可还原《动物园规则怪谈》式「多份矛盾守则 + 玩家自行推理」的玩法。

## 证据组合推理

推理玩法区分三个概念：Document 是可阅读载体，Evidence 是可用于论证的材料，Deduction 是玩家在推理板用证据确认的命题。

```ts
interface Evidence {
  id: string
  title: string
  description: string
  kind?: 'document' | 'object' | 'testimony' | 'observation'
  source?: string
}

interface Deduction {
  id: string
  statement: string
  description?: string
  hint?: string              // 证据不足时的非剧透调查方向
  requires: { all?: string[]; anyOf?: string[][] }
  onConfirmed?: Effects
}
```

节点用 `gainEvidence` 发放证据。玩家在推理板选择证据组合；推论成立后可用 `#deduction` 条件解锁对话、场景或结局。节点 `objective` 可显示当前目标，推论 `hint` 可提示调查方向。完整设计约定见 `docs/deduction-mvp.md`，可运行样例见 `examples/deduction-demo.story.json`。

## 人物关系、记忆与秘密

人物通过 `story_upsert_character` 定义，并在同一人物内声明关系维度和秘密。关系数值表示程度，记忆表示关系变化的叙事原因，秘密表示玩家已经获知的角色信息。

```ts
interface Character {
  id: string
  name: string
  description: string
  relations?: Record<string, { label: string; initial?: number; min?: number; max?: number }>
  secrets?: Record<string, { id: string; title: string; description: string }>
}
```

- 关系条件：`{ op: 'gte', var: '#relation:maid:trust', value: 2 }`；
- 记忆条件：`{ op: 'eq', var: '#memory', value: 'protected_maid' }`；
- 秘密条件：`{ op: 'eq', var: '#secret', value: 'maid:hidden_corridor' }`。

玩家可在游戏中的“人物”页查看当前关系和已揭示秘密。完整约定见 `docs/relationships-mvp.md`，样例见 `examples/relationship-demo.story.json`。

## 密码谜题与渐进提示

第一版谜题采用确定性的密码输入，不依赖联网模型：

```ts
interface Puzzle {
  id: string
  title: string
  prompt: string
  kind: 'code'
  solution: string
  caseSensitive?: boolean
  hints?: string[]
  requires?: Condition
  onSolved?: Effects
}
```

玩家通过游戏内信息推导答案，在“谜题”页输入并验证；错误尝试、提示进度和已解状态都会保存。节点用 `#puzzle` 条件解锁后续内容。完整约定见 `docs/puzzles-mvp.md`，样例见 `examples/puzzle-demo.story.json`。

## AI 使用指引（典型工作流）

1. `story_new { title, subtitle }` — 创建项目（自带 start + 示例结局骨架）；
2. `story_delete_node { nodeId: 'end', force: true }` + `story_delete_ending { endingId: 'e_end' }`
   — 清掉示例骨架（或用 `story_upsert_node` 覆盖 `start` 节点）；
3. `story_upsert_node { node }` × N — 逐个写节点（先写节点再统一校验，中途断链属正常）；
4. `story_graph { title }` — 用 mermaid 检查分支结构；
5. `story_validate { title }` — 校验 + 路径探索模拟，确认所有结局可达、无断链；
6. `story_export { title }` — 导出单文件 HTML；把 `outputPath` 交给用户即可。

示例成品：《迷雾车站》（10 节点 / 3 结局，含条件选项、道具「旧伞」、旗标、线索文档与规则文本块），
运行 `node scripts/demo.mjs` 通过 MCP 协议全流程生成到 `projects/迷雾车站/dist/index.html`。
注：`projects/` 是 AI 运行时生成的项目目录（不入库），仓库内不包含具体游戏。

## 目录结构

```
src/
├── core/          # 引擎核心（纯逻辑，无 DOM）
│   ├── types.ts   #   数据模型
│   ├── schema.ts  #   共享 Story Schema（zod 校验 / 版本迁移）
│   ├── engine.ts  #   Game 状态机
│   ├── conditions.ts / effects.ts
│   ├── validate.ts / walk.ts
│   └── fixtures.ts / *.test.ts
├── export/        # 单文件 HTML 导出
│   ├── runtime.ts #   运行时渲染器（打包进 HTML）
│   ├── exporter.ts#   esbuild bundle + 导出流程
│   ├── template.ts#   HTML 模板 + 内联 CSS
│   └── *.test.ts
├── mcp/           # MCP 服务器
│   ├── projects.ts #  项目存储（projects/ 目录）
│   ├── handlers.ts #  工具实现（可单测）
│   └── server.ts   #  stdio transport + 工具注册
scripts/           # build-runtime / verify-mcp / demo / verify-export
projects/          # AI 创建的游戏项目（gitignore）
```
