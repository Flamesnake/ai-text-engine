# 优化与修复清单（Review 汇总）

> 来源：2026-02 两轮代码审查（舞台渲染专项 + 全模块普查）。
> 用法：每条含【位置】【问题】【修复方案】【验收】，按建议批次执行；完成一项勾一项。
> 本文档只记录"改什么、怎么验证"，具体实现以当时代码为准。

## 建议执行批次

| 批次 | 内容 | 理由 |
|---|---|---|
| 批次 1：存档健壮性 | P0-1 + P0-2 | 同为存档格式 v2，一次改完 |
| 批次 2：成本与护栏 | P1-1 + P1-2 + P1-3 | 都是"防静默事故/省 token"的小改动 |
| 批次 3：舞台渲染收尾 | P1-4 + P1-5 + P1-6 + P2-4 | 舞台管线同一文件，集中改集中测 |
| 批次 4：导出链 | P1-7 + P2-1 | 动 exporter 时一起做 |
| 批次 5：架构重构 | P2-2 + P2-3 + P2-5 | 下一次大功能前的前置重构 |
| 批次 6：体验打磨 | P3-* | 随时插空做 |

---

## P0 — 数据安全（优先）

- [x] **P0-1 存档格式无版本号**
  - 【位置】`src/core/engine.ts`（`GameState` / `toSave()` / `assertSave()`）
  - 【问题】剧情 schema 有 `SCHEMA_VERSION`（见 `projects.ts` skeleton），但存档没有版本字段。当前靠宽松默认值兼容旧档；未来任何破坏性变更（如 `relations` 结构、变量语义调整）会让旧存档**静默错乱**而非明确报错。
  - 【修复】`GameState` 增加 `saveVersion: 1`（常量导出）；`assertSave` 遇到未知版本抛出带版本号的明确错误；预留 `migrateSave()` 钩子（初版可为空实现）。
  - 【验收】新增测试：缺版本存档按 v1 恢复；`saveVersion: 999` 抛出含"版本"字样的错误；现有存档测试全部保持通过。

- [x] **P0-2 存档 key 用标题，file:// 下跨作品互相覆盖**
  - 【位置】`src/export/runtime.ts`（`saveKey = 'ate:' + story.meta.title`）
  - 【问题】导出游戏多以 `file://` 打开，主流浏览器把 `file://` 的 localStorage 挂在整个 file:// 源上——同名标题（或改名前的旧作）读写同一份存档。
  - 【修复】`story_new` 生成 `meta.uid`（短随机 id）；saveKey 改为 `ate:{uid}`；无 uid 的旧作品回退标题 key。标题只用于展示。
  - 【验收】测试：两部同标题不同 uid 的作品存档互不干扰；无 uid 作品行为与现状一致；`meta.uid` 进 schema（可选字段，strict 不拒绝）。

- [x] **P0-3 `Game.state` 返回活引用**
  - 【位置】`src/core/engine.ts:83`
  - 【问题】`get state(): Readonly<GameState>` 返回内部 `st` 本体，类型只读但运行时可写，封装洞。
  - 【修复】返回浅拷贝（数组/对象字段浅拷一层即可，与 `toSave()` 同策略但不含 updatedAt 刷新）；或开发期 `Object.freeze`。
  - 【验收】测试：经 `state` 修改数组不影响内部状态；现有 runtime 测试通过（runtime 只读使用，预期无回归）。

- [x] **P0-4 `loadedCache` 只进不出**
  - 【位置】`src/mcp/projects.ts:176`
  - 【问题】每次读/存都把完整 story.json 原文塞进 Map，长驻 MCP 进程永不淘汰，长会话内存缓慢增长。
  - 【修复】改为简易 LRU（上限约 20 条，超出淘汰最久未用）。
  - 【验收】测试：连续读写 25 个不同项目后 cache size ≤ 20；冲突检测对未淘汰条目仍生效。

---

## P1 — 正确性 / 成本 / 护栏

- [x] **P1-1 MCP 响应统一美化 JSON，浪费 token**
  - 【位置】`src/mcp/server.ts:44`（`JSON.stringify(result, null, 2)`）
  - 【问题】项目自己强调 token 成本（compact 模式、observability 字节统计），但所有工具结果 2 空格缩进，大结果（story_get / walk / evaluate）膨胀 15–30%。
  - 【修复】按字节阈值切换：小结果（如 <2KB）保留 pretty，大结果紧凑序列化；或全面紧凑（MCP 客户端本来就不展示原文）。
  - 【验收】`story_observability` 前后对比同一作品的 `story_get` 响应字节数下降；现有 handlers 测试（解析 JSON）通过。

- [x] **P1-2 预构建 runtime 无新鲜度护栏**
  - 【位置】`src/export/exporter.ts:60-69`（`bundleRuntime`）
  - 【问题】minify 时直接读 `dist/export/runtime.bundle.js`，改了 `src/export/*` 忘 build 时 `story_export` **静默**用旧 runtime。
  - 【修复】`build-runtime.mjs` 在 bundle 头部注入构建时间戳/源文件哈希注释；导出时若 `src/export/` 最新 mtime 晚于 bundle 时间戳，console.warn 提示（npm 包场景 src 不存在则跳过检查）。
  - 【验收】手动改动 `src/export/` 任一文件后调用导出，stderr/返回结果出现过期提示；npm 包安装路径下不误报。

- [x] **P1-3 CLI 缺 export / validate 命令；version 命令跑全套 doctor**
  - 【位置】`src/cli.ts`、`src/cli/commands.ts`
  - 【问题】导出/校验只能走 MCP 或脚本，非 Agent 用户与 CI 流水线无入口；`version` 命令却执行完整 `doctor()`（多余文件系统检查）。
  - 【修复】新增 `talespindle export <title> [--out dir]`、`talespindle validate <title>`（薄封装现有 handlers）；`version` 直接读 `ENGINE_VERSION`。
  - 【验收】CLI 冒烟：`export` 产出 HTML 且与 MCP 导出一致；`version` 毫秒级返回。

- [x] **P1-4 WebGL 舞台路径丢失无障碍语义**
  - 【位置】`src/export/runtime.ts:271-287`（`openStageCutscene`）
  - 【问题】CSS 回退舞台有完整 `aria-label`（角色/站位/姿态，见 `renderStage()`），3D 路径只有裸 `<canvas>`，屏幕阅读器读不到任何场景信息，违反 `docs/stage-direction.md` 的可访问性承诺。
  - 【修复】给 3D canvas 加 `role="img"` 和与 CSS 版一致的 `aria-label`（复用 renderStage 的文案生成逻辑，抽共用函数）。
  - 【验收】测试：WebGL 可用路径下 canvas 的 aria-label 包含角色名；CSS 回退路径现状不变。

- [x] **P1-5 每次过场新建 WebGL 上下文，长流程有耗尽风险**
  - 【位置】`src/export/stage3d.ts`（`createStage3d` / `dispose`）
  - 【问题】Chrome 活跃 WebGL 上下文约 16 个上限；`renderer.dispose()` 回收依赖 GC 时机，多过场长流程可能触发 "Too many active WebGL contexts"。
  - 【修复】两选一：(a) `dispose()` 中先 `renderer.forceContextLoss()`；(b) 模块级复用单 renderer，只重建 scene。优先 (a)，改动最小。
  - 【验收】手动验证：连续进出 20 次舞台过场，控制台无上下文警告；`dispose` 后 `renderer.getContext().isContextLost()` 为 true。

- [x] **P1-6 合成画布缺 `willReadFrequently`**
  - 【位置】`src/export/stage3d.ts`（`getContext('2d')` 两处：输出与缓冲画布）
  - 【问题】每帧 `getImageData`/`putImageData` 未声明 `willReadFrequently: true`，浏览器走 GPU 回读路径，部分机器掉帧。
  - 【修复】两个 `getContext('2d')` 调用加 `{ willReadFrequently: true }`。
  - 【验收】Chrome 性能面板对比：合成帧耗时下降或无回归；无功能变化。

- [x] **P1-7 不用舞台的作品也背负 three.js（~600KB）**
  - 【位置】`src/export/runtime.ts` 静态 import `./stage3d.js`；`scripts/build-runtime.mjs`
  - 【问题】runtime.bundle.js 587KB 主要来自 three；纯文字作品导出同样 ~650KB。
  - 【修复】构建两条产物（full / lite，lite 用 esbuild alias 把 stage3d 换成空桩）；`exportToHtml` 扫描 story 是否含任何 `stage` cue，无则选 lite bundle。
  - 【验收】无舞台作品导出体积显著下降（预期 <150KB）；含舞台作品与现状一致；`story_export` 返回的 sizeBytes 体现差异。

---

## P2 — 架构 / 可维护性

- [x] **P2-1 调色板三处重复**
  - 【位置】`src/export/template.ts:503-509`（CSS）、`src/export/stage3d.ts`（BACKDROP/FLOOR 常量）、主题变量
  - 【问题】改一种背景色要同步三处。
  - 【修复】抽 `stage-palette.ts` 共享常量；CSS 侧由模板构建期注入（或 CSS 变量）。
  - 【验收】三处引用同一常量源；改一个色值后 CSS 回退与 3D 舞台视觉一致。

- [x] **P2-2 `runtime.ts` 单体闭包（64.8KB / 74+ 函数）**
  - 【位置】`src/export/runtime.ts`
  - 【问题】舞台、手册、逐字输出、拟态网站、主题解析全在一个 `mountTextAdventure` 作用域；每次加功能都在恶化。
  - 【修复】拆 `runtime/stage.ts`、`runtime/handbook.ts`、`runtime/typewriter.ts`、`runtime/site.ts`，共享显式 ctx 对象；保持 `mountTextAdventure` 对外签名不变。
  - 【验收】拆分后 runtime.test.ts 全绿且无需大改；导出 HTML 行为一致（witness-replay 全过）。

- [x] **P2-3 `handlers.ts` 集中全部 29 个 MCP 工具（26.6KB）**
  - 【位置】`src/mcp/handlers.ts`、`src/mcp/server.ts`
  - 【问题】工具描述（server.ts 15KB）与实现分离，新增工具要在两个大文件里同步找位置。
  - 【修复】按域拆 `handlers/nodes.ts`、`handlers/characters.ts`、`handlers/evidence.ts`、`handlers/meta.ts`；工具描述与实现同址（每域导出"描述+schema+handler"三元组，server.ts 只做注册循环）。
  - 【验收】server.ts 缩减为注册表；handlers 测试全绿；`story_observability` 工具名不变。

- [x] **P2-4 3D 舞台真实渲染路径零覆盖**
  - 【位置】`src/export/stage3d.ts`、`src/export/stage3d.test.ts`
  - 【问题】happy-dom 无 WebGL，现有测试只覆盖纯函数与 null 回退；灯光组/粒子/追光跟随的场景图构建无法被测试触及。
  - 【修复】把"建 scene graph"与"创建 renderer"解耦：`buildStageScene(cue, actors)` 返回纯 Object3D 树 + 灯光/粒子描述，测试无需 GL 即可断言结构（灯位数、焦点追光目标、粒子数量、姿态 rotation）。顺带为 P1-5 的 (b) 方案铺路。
  - 【验收】新测试断言：spotlight 预设下追光目标=焦点角色 x；void 背景粒子=sparks 规格；afraid 姿态 crouch>0 体现在 group scale。

- [x] **P2-5 `template.ts` 47.6KB CSS-in-TS**
  - 【位置】`src/export/template.ts`
  - 【问题】CSS 无高亮无 lint，改样式靠猜。
  - 【修复】抽 `template.css`，构建期 `readFile` 注入（exporter 本来就在 Node 侧跑）；vitest 同样能读。
  - 【验收】导出 HTML 字节级一致（除空白）；模板函数签名不变。

---

## P3 — 体验打磨 / 工程卫生

- [x] **P3-1 声景是静态循环**——`src/export/sfx.ts:191-240`：rain/wind 等为固定滤波噪声 loop，30 秒后听感"平"。给滤波频率或 gain 挂慢速 LFO（0.05–0.2Hz）。验收：听感有起伏；sfx 测试通过。
- [x] **P3-2 walk 见证搜索预算按结局叠加**——`src/core/walk.ts:135`：`witnessMaxStates` 25k/结局且互不共享已探索状态，多结局大作品有性能悬崖。暂只加观测（返回见证搜索耗时），遇真实投诉再优化为一次搜索多结局收集。
- [x] **P3-3 CI 缺发布护栏**——`.github/workflows/ci.yml` 只跑 typecheck/test/build；把 `check:package`（verify-package）加入 CI 或 release workflow。
- [x] **P3-4 npm 文档白名单不一致**——`package.json` files 只带 4 篇 docs，但 puzzles/deductions/relationships 三篇 MVP 文档恰是作者最需要的却没进包；`plugin-readiness`、`product-roadmap` 等内部稿建议挪 `docs/dev/` 分区。
- [x] **P3-5 工作区积压未提交改动**——18 改 + 2 未跟踪文件混了多条功能线；按功能分批提交；CHANGELOG 的 Unreleased 段补记舞台渲染升级（15bit 量化/抖动、剧场灯光组、镜头 DSL、姿态演出、空气粒子）。

---

## 已完成的关联工作（备查）

- 2026-02：舞台渲染重写（合成管线/剧场灯光/镜头 DSL/姿态演出/空气粒子），见 `src/export/stage3d.ts` 与 `docs/stage-direction.md` 动画边界一节；本清单中 P1-4~P1-6、P2-4 是其后续收尾。
