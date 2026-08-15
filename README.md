# TaleSpindle

An agent-first interactive narrative engine. TaleSpindle lets Claude, Codex, Cursor, and other
MCP-capable agents create, validate, test, and export **self-contained HTML text adventures**.

- **剧情 = 纯 JSON 数据**：AI 用工具增删节点，无需写代码；
- **通用机制**：变量 / 道具 / 旗标 / 条件选项 / 节点进入效果，够做悬疑、RPG、怪谈等题材；
- **单文件导出**：`story_export` 产出一个自包含 `index.html`，双击即玩、可发任何人、零依赖；
- **质量闭环**：静态校验、结局见证、失败路线、DOM 重放与体验评估共同发现结构和交互问题；
- **推理与演出**：内置证据、推论、谜题、人物关系、受控富文本和轻量声画效果；
- **宿主无关**：核心是普通 Node.js + MCP 服务，未来可以通过薄适配层接入不同 Agent Harness。

设计与创作参考：[叙事文本与节点连续性](docs/narrative-quality.md) · [世界/阶段状态](docs/world-state.md) · [受控舞台调度](docs/stage-direction.md) · [拟态网页外壳](docs/web-shells.md)

## 安装

正式 npm 包名为 `@marianaj/talespindle`。普通用户不需要 clone 仓库、运行构建，也不需要安装 DeepSeek Harness；只需 Node.js 20+ 和一个支持 stdio MCP 的 Agent 客户端。

### Codex：三步安装

```bash
# 1. 检查 Node、数据目录、预构建运行时和 MCP
npx -y @marianaj/talespindle@latest doctor

# 2. 安装配套创作 Skill
npx -y @marianaj/talespindle@latest install-skill --client codex

# 3. 把 npm 包持久注册为 Codex MCP server
codex mcp add talespindle -- npx -y @marianaj/talespindle@latest mcp
```

完成后重启或刷新 Codex，在新任务中检查是否出现 `story_new`、`story_validate`、`story_export` 等 `story_` 工具。Skill 可见但没有这些工具，说明 MCP 尚未连接。

升级时无需重新注册 MCP；重新安装 Skill 即可同步新版创作流程：

```bash
npx -y @marianaj/talespindle@latest doctor
npx -y @marianaj/talespindle@latest install-skill --client codex --force
```

Codex 与通用 Agent Skill 默认安装到 `~/.agents/skills/talespindle-author`。`install-skill` 也支持 `--client agents` 和 `--client claude`；已有同名 Skill 时，只有显式传入 `--force` 才会覆盖。

### 其他 MCP 客户端

Claude Desktop、Cursor 等使用 JSON 配置的客户端可注册同一条 npm 命令：

```json
{
  "mcpServers": {
    "talespindle": {
      "command": "npx",
      "args": ["-y", "@marianaj/talespindle@latest", "mcp"]
    }
  }
}
```

使用 TOML 配置的客户端可采用：

```toml
[mcp_servers."talespindle"]
command = "npx"
args = ["-y", "@marianaj/talespindle@latest", "mcp"]
enabled = true
startup_timeout_sec = 30
tool_timeout_sec = 360
```

不同客户端读取的配置位置不同；仓库根目录的 `.mcp.json` 不能证明客户端已经注册服务器。已有的 `ai-text-engine` MCP 键名和 CLI 别名仍兼容，但新安装统一使用 `talespindle`。

### 作品目录

npm 版本默认把作品写到操作系统用户数据目录，不会写进 `node_modules`。设置 `TALESPINDLE_HOME` 可指定数据根目录，作品位于其 `projects/` 子目录；旧变量 `AI_TEXT_ENGINE_HOME` 仍兼容。

```bash
npx -y @marianaj/talespindle@latest init --home C:/path/to/talespindle-data
```

仓库自身的 `projects/` 是开发者本地创作区，已被 Git 整体忽略；其中的 `story.json`、导出 HTML 和个人作品不会进入源码提交或 npm 包。

## 从源码开发

```bash
npm install
npm run build
npm test
npm run mcp
npm run check:release
npm run check:package
```

构建后也可直接使用本地 CLI：

```bash
node dist/cli.js doctor
node dist/cli.js install-skill --client codex
codex mcp add talespindle-local -- node E:/path/to/talespindle/dist/cli.js mcp
```

配套 Skill 源文件位于 `skill/SKILL.md`。客户端加载的是已安装副本；修改 Skill 源文件后需要重新运行 `install-skill --force`。`npm run check:release` 会读取本机 `projects/` 做兼容性回归，但不会复制、修改或上传作品。

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
| `story_get_node` | 读取单个节点及其入边，避免局部修稿时全量读取 |
| `story_review_transitions` | 分页返回源末段、选项承接和目标首段；`onlyRisks:true` 优先定位缺承接与机械重复 |
| `story_patch_choice` | 只修改一个选项；可断言旧 label/target 防止按过期索引误改 |
| `story_upsert_node` | 创建/覆盖节点（结局自动登记到结局表） |
| `story_delete_node` | 删除节点（有引用时需 `force: true`，会报告断链） |
| `story_delete_ending` | 从结局表删除结局（被节点使用时拒绝） |
| `story_upsert_achievement` / `story_delete_achievement` | 添加/删除成就定义 |
| `story_upsert_document` / `story_delete_document` | 添加/删除线索/文档（规则守则/便条/信件，可被收集查看） |
| `story_upsert_evidence` / `story_delete_evidence` | 添加/删除可用于推理的证据 |
| `story_upsert_deduction` / `story_delete_deduction` | 添加/删除证据组合推论 |
| `story_upsert_character` / `story_delete_character` | 添加/删除包含关系维度与秘密的人物 |
| `story_upsert_puzzle` / `story_delete_puzzle` | 添加/删除密码谜题、渐进提示与成功效果 |
| `story_validate` | 校验 + 路径探索模拟；反复修订时可用 `compact:true` 省略长见证动作 |
| `story_evaluate` | 作品体验评估；支持 `compact:true`，不打总分 |
| `story_walk` | 结局见证与覆盖诊断；支持 `compact:true`，最终重放前再取完整动作 |
| `story_graph` | 生成 mermaid 分支图（审查结构用） |
| `story_export` | 导出单文件 HTML（校验不通过时拒绝） |
| `story_set_meta` | 更新副标题 / 作者 / **主题** / **HUD** / **初始声景** / **拟态网站身份** |
| `story_set_presentation` | 设置 `novel/dossier/chat/cinematic` 外壳与字体、密度、形状、选项风格 |
| `story_list` | 列出所有项目 |
| `story_delete_project` | 删除整个项目 |
| `story_observability` / `story_observability_reset` | 查看/清零本地 MCP 成本摘要（调用、字节、粗略 token、耗时、重复覆盖） |

项目数据存放在 `projects/<标题>/story.json`，导出物在 `projects/<标题>/dist/index.html`。

复杂开放结构调试时先调用
`story_walk { title, compact: true, diagnostics: true, topNodes: 10, maxStates?: 100000, witnessMaxStates?: 25000 }`。
`reachability` 为每个已证明可达的结局返回一条可重放 `witness`；`failures.witnesses` 返回已经找到的
条件软锁与无结局终点路线，`failures.complete` 表示失败搜索是否完整。即使全量探索超出
`maxStates`，walker 也会在每个缺失结局上追加一次目标导向搜索。`coverage.complete` 单独表示
全状态覆盖是否完成，`coverage.reasons` 说明受限原因，`budget.utilization` 与 `hotNodes` 用来定位
高频 hub/回环。兼容字段 `truncated` 只表示主探索耗尽全局状态预算，不再等同于“结局不可达”。
构建后可用 `node scripts/verify-walk-witnesses.mjs "作品名"` 在真实 `Game` 中批量重放这些见证；
再用 `node scripts/verify-dom-witnesses.mjs "作品名"` 自动操作真实运行时的选项、推理板、谜题输入与返回按钮，并确认失败见证确实会把玩家锁住；发现失败路径时命令以非零状态退出。
两者都不会评价谜题公平性、文案提示和演出节奏，不能完全替代人工试玩。

导出前可调用 `story_evaluate { title, compact: true }` 集中检查作品。它返回事实指标与带证据的候选问题，
包括无状态自循环、重复选择结果、response 重复目标开头和未回收的证据/推论/谜题；摘要中的节点、选项、成就等数量可直接用于交付报告。它不输出总分，也不会因题材未采用谜题或人物关系而机械告警。第一轮校准基线见
[`docs/evals/evaluation-baseline.md`](docs/evals/evaluation-baseline.md)。

盲测前调用 `story_observability_reset {}`，完成后调用 `story_observability {}`，可得到本次 MCP
进程内的调用次数、失败、请求/响应字节、粗略 token、耗时、全量/单节点读取、转场审查、walk、导出和重复覆盖摘要。`tools` 明细可按响应字节与耗时定位最昂贵的调用；交付报告不要只抄总量。
摘要只保留聚合数字与资源 id，不记录剧情正文，也不等同于模型平台账单。

## 剧情数据格式

```ts
interface Story {
  meta: { title: string; subtitle?: string; version?: string; author?: string; site?: SiteConfig }
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
  soundscape?: SoundscapeSpec | 'silence' // 持续声景切换点；未声明则沿用
  stage?: StageCue | 'clear'       // 受控舞台；未声明沿用，clear 撤台
  page?: WebPageMeta               // 拟态网页页面语义；导航仍使用 choices
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

### 受控舞台调度

只有特殊剧情表现与过场动画——如关键对质、告白、惊吓、真相重演或结局定格——使用 `stage` 声明程序化布景、灯光、镜头和最多三名角色的站位。普通调查和常规对白维持文字界面。配置沿历史持续，后续节点只写变化项；`actors` 整体替换，`"stage": "clear"` 撤台。

```jsonc
{
  "stage": {
    "backdrop": "archive",
    "lighting": "spotlight",
    "camera": "push",
    "actors": [
      { "characterId": "witness", "position": "left", "pose": "afraid" },
      { "characterId": "suspect", "position": "right", "pose": "shadow", "focus": true, "entrance": "fade" }
    ]
  }
}
```

布景：`neutral/interior/exterior/shore/industrial/archive/void`；灯光：`natural/warm/cool/night/alert/blackout/spotlight`；镜头：`wide/medium/close/push`。`push` 和 `entrance` 只播放一次，减弱动态模式自动关闭动画。完整契约和 token 使用建议见 [`docs/stage-direction.md`](docs/stage-direction.md)。

### 持续声景

`sfx` 是一次性事件，`soundscape` 是跨节点持续的环境声。初始声景可用
`story_set_meta { soundscape }` 设置；节点只在声音发生变化时声明，后续未声明节点自动沿用，
用 `"soundscape": "silence"` 淡出到寂静。切换采用固定交叉淡化，不开放任意音符、频率或音频文件。

```jsonc
{ "name": "rain", "intensity": "subtle" }
```

可用声景：`rain`、`wind`、`storm`、`waves`、`broadcast`、`electric`、`ventilation`、
`engine`、`void`；强度为 `subtle`、`medium`、`strong`。静音会立即影响短音效和持续声景，
关闭游戏时共享 AudioContext 与所有持续声音都会释放。

### 世界状态与阶段

`meta.world` 表示表世界/里世界等叙事位面，`meta.phase` 表示白天/夜晚、正常/警报等阶段。
二者使用相同的紧凑结构，可覆盖主题、视觉配方和持续声景；选项逻辑继续显式使用
`{ "op": "eq", "var": "#world", "value": "other" }` 或 `#phase`，不要藏进 CSS。

```jsonc
{
  "world": {
    "initial": "surface",
    "states": {
      "surface": { "label": "表世界", "theme": "paper" },
      "other": {
        "label": "里世界",
        "theme": "cyber",
        "presentation": { "shell": "cinematic", "typography": "mono" },
        "soundscape": { "name": "void", "intensity": "strong" }
      }
    }
  },
  "phase": {
    "initial": "day",
    "states": { "day": {}, "night": { "soundscape": { "name": "wind" } } }
  }
}
```

用节点 `onEnter` 或选项 `effects` 中的 `world: "other"`、`phase: "night"` 切换。
状态会进入存档和 walk 状态键；恢复存档时主题、排版、声景与可见选项同步恢复。完整契约见
[`docs/world-state.md`](docs/world-state.md)。

### 拟态新闻网页

用一次 `story_set_meta` 设置 `site`，即可让标题屏和游戏页面表现为离线新闻站；节点只用 `page` 补充页面标题等差异。所有报道链接仍是普通 `choices`，所以条件、效果、walk、存档和 DOM 重放继续使用同一剧情图。

```jsonc
{
  "site": { "kind": "news", "name": "汐见晚报", "tagline": "潮水退去后，事实仍在。", "locale": "汐见町" }
}
```

```jsonc
{
  "page": {
    "layout": "frontpage",
    "section": "本地",
    "headline": "旧灯塔将在今日永久关闭",
    "byline": "闻舟",
    "timestamp": "8 月 31 日 18:40"
  }
}
```

布局支持 `frontpage/article/bulletin`。不要生成真实登录页、表单、独立 URL、远程请求或 JavaScript 路由；详细契约见 [`docs/web-shells.md`](docs/web-shells.md)。

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
