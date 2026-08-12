# ai-text-engine · 给 AI 用的文字冒险引擎 + MCP 服务器

让 AI（Claude / Cursor / 任何支持 MCP 的 agent）通过 **MCP 工具**创建、编辑、校验并导出
**单文件 HTML 文字冒险游戏**的引擎。

- **剧情 = 纯 JSON 数据**：AI 用工具增删节点，无需写代码；
- **通用机制**：变量 / 道具 / 旗标 / 条件选项 / 节点进入效果，够做悬疑、RPG、怪谈等题材；
- **单文件导出**：`story_export` 产出一个自包含 `index.html`，双击即玩、可发任何人、零依赖；
- **强校验**：断链、不可达节点、结局登记、变量拼写错误都会被自动发现；
- **全路径模拟**：自动遍历所有分支，报告每个结局的可达路径数与最短步数。

## 快速开始

> 配套 AI skill：`ai-text-engine`（已安装到全局技能目录 `~/.agents/skills/ai-text-engine/`）。
> AI 加载该 skill 后即可按标准工作流（建项目 → 写节点 → 校验 → 导出）直接开工，无需读本文档。

```bash
npm install          # 安装依赖
npm run build        # 编译到 dist/（tsc）+ 打包运行时（esbuild）
npm test             # 40 个测试（vitest）
npm run mcp          # 以 stdio 方式启动 MCP 服务器
```

### 注册到 AI 客户端

工作区根目录的 `.mcp.json` 已注册（Windows 绝对路径）：

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

> 把 `C:/path/to/ai-text-engine` 换成你 clone 后的实际路径（Windows 用正斜杠或转义反斜杠）。

也可以在 Claude Desktop / Cursor 等客户端的 MCP 配置中按同样方式添加。

### 验证

```bash
node scripts/verify-mcp.mjs      # stdio 握手 + 工具清单（应输出 VERIFY OK，11 个工具）
node scripts/demo.mjs            # 端到端演示：AI 全流程构建《迷雾车站》并导出
node scripts/verify-export.mjs   # 验证导出 HTML 内嵌剧情可玩
```

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
| `story_validate` | 校验 + 全路径模拟（结局覆盖统计） |
| `story_walk` | 全路径模拟（各结局路径数 / 最短步数 / 未到达结局） |
| `story_graph` | 生成 mermaid 分支图（审查结构用） |
| `story_export` | 导出单文件 HTML（校验不通过时拒绝） |
| `story_set_meta` | 更新副标题 / 作者 / **主题** / **HUD 统计条** |
| `story_list` | 列出所有项目 |
| `story_delete_project` | 删除整个项目 |

项目数据存放在 `projects/<标题>/story.json`，导出物在 `projects/<标题>/dist/index.html`。

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
  gain?: string[]                                  // 获得道具
  lose?: string[]                                  // 失去道具
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

- 条件 `has` / `not_has`：`var` 视为**道具名**，检查 `inventory`；
- 条件 `exists`：检查变量是否已定义；其余比较符与 `vars[var]` 比较；
- **旗标与变量同命名空间**（`flag` 效果写进 `vars`），条件可直接引用；
- 结局节点：`choices: []` 且带 `ending`；选项的 `target` 必须指向存在的节点；
- 正文/选项文案中的 `{未写入变量}` 会被 `story_validate` 报告（疑似拼写错误）。

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

## AI 使用指引（典型工作流）

1. `story_new { title, subtitle }` — 创建项目（自带 start + 示例结局骨架）；
2. `story_delete_node { nodeId: 'end', force: true }` + `story_delete_ending { endingId: 'e_end' }`
   — 清掉示例骨架（或用 `story_upsert_node` 覆盖 `start` 节点）；
3. `story_upsert_node { node }` × N — 逐个写节点（先写节点再统一校验，中途断链属正常）；
4. `story_graph { title }` — 用 mermaid 检查分支结构；
5. `story_validate { title }` — 校验 + 全路径模拟，确认所有结局可达、无断链；
6. `story_export { title }` — 导出单文件 HTML；把 `outputPath` 交给用户即可。

示例成品：《迷雾车站》（10 节点 / 3 结局，含条件选项、道具「旧伞」、旗标、线索文档与规则文本块），
运行 `node scripts/demo.mjs` 通过 MCP 协议全流程生成到 `projects/迷雾车站/dist/index.html`。
注：`projects/` 是 AI 运行时生成的项目目录（不入库），仓库内不包含具体游戏。

## 目录结构

```
src/
├── core/          # 引擎核心（纯逻辑，无 DOM）
│   ├── types.ts   #   数据模型
│   ├── engine.ts  #   Game 状态机
│   ├── conditions.ts / effects.ts
│   ├── validate.ts / walk.ts
│   └── fixtures.ts / *.test.ts
├── export/        # 单文件 HTML 导出
│   ├── runtime.ts #   运行时渲染器（打包进 HTML）
│   ├── exporter.ts#   esbuild bundle + 模板拼装
│   └── *.test.ts
├── mcp/           # MCP 服务器
│   ├── projects.ts #  项目存储（projects/ 目录）
│   ├── handlers.ts #  工具实现（可单测）
│   └── server.ts   #  stdio transport + 工具注册
scripts/           # build-runtime / verify-mcp / demo / verify-export
projects/          # AI 创建的游戏项目（gitignore）
```
