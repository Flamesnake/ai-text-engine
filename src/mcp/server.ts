import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import * as handlers from './handlers.js'
import { observeToolCall, resetObservability, snapshotObservability } from './observability.js'
import { ENGINE_VERSION } from '../version.js'
import {
  AchievementSchema,
  ChoicePatchSchema,
  HudStatSchema,
  StoryDocumentSchema,
  StrictStoryNodeSchema,
  ThemeConfigSchema,
  PresentationConfigSchema,
  EvidenceSchema,
  DeductionSchema,
  CharacterSchema,
  PuzzleSchema,
  SoundscapeSpecSchema,
  StateAxisConfigSchema,
} from '../core/schema.js'

/**
 * TaleSpindle MCP 服务器（stdio）。
 * 让 AI 客户端通过工具操作引擎：创建项目、编辑节点、校验、导出单文件 HTML。
 *
 * 启动：npm run mcp （或 node dist/mcp/server.js）
 * 注册：在 .mcp.json 的 mcpServers 中引用本服务器。
 */

const server = new McpServer({
  name: 'talespindle',
  version: ENGINE_VERSION,
})

/** 统一包装：结果 JSON 序列化；异常转为 isError 响应 */
function wrap(tool: string, handler: (args: any) => Promise<unknown>, observe = true) {
  return async (args: any) => {
    try {
      const result = observe
        ? await observeToolCall(tool, args, () => handler(args))
        : await handler(args)
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `错误：${err instanceof Error ? err.message : String(err)}` }],
      }
    }
  }
}

/* ------------------------------ 工具注册 ------------------------------ */

server.tool(
  'story_new',
  '创建新的文字冒险游戏项目（写 projects/<标题>/story.json 骨架）。标题已存在时返回现有项目。',
  { title: z.string(), subtitle: z.string().optional(), author: z.string().optional() },
  wrap('story_new', (args) => handlers.newProject(args)),
)

server.tool(
  'story_get',
  '读取整个剧情的完整 JSON（含所有节点/选项/结局/条件/效果）。',
  { title: z.string() },
  wrap('story_get', (args) => handlers.getStory(args.title)),
)

server.tool(
  'story_upsert_node',
  '创建或覆盖一个节点（按 node.id）。node 为完整节点对象：{id, objective?: 当前目标, text, blocks?, sfx?, soundscape?, stage?, choices[], puzzles?: 谜题id[], ending?, onEnter?, tags?, note?}。choice 可带短 response，点击后显示在目标正文前，适合不同选项汇入同一节点时承接玩家行动。text 始终必填，即使提供 blocks；节点进入效果只能写 onEnter，节点顶层没有 effects。soundscape 是受控持续声景对象或 silence，只在声音变化处声明。stage 是受控舞台差异 cue 或 clear，未声明会沿用，不要逐节点复制完整配置。未知字段会被拒绝。调查中心、谜题现场和结案阶段应写清 objective；新谜题应通过 puzzles 放进具体场景，成为正文下方的主要行动。写入后自动返回校验结果。',
  { title: z.string(), node: StrictStoryNodeSchema },
  wrap('story_upsert_node', (args) => handlers.upsertNode(args)),
)

server.tool(
  'story_delete_node',
  '删除节点。若仍有其他选项指向它且未传 force，将报错列出引用处；force:true 会强行删除（可能产生断链）。',
  {
    title: z.string(),
    nodeId: z.string(),
    force: z.boolean().optional(),
  },
  wrap('story_delete_node', (args) => handlers.deleteNode(args)),
)

server.tool(
  'story_delete_ending',
  '从结局表删除一个结局（若有节点仍使用它则报错）。创建项目时自带的示例结局可用此工具清理。',
  { title: z.string(), endingId: z.string() },
  wrap('story_delete_ending', (args) => handlers.deleteEnding(args)),
)

server.tool(
  'story_validate',
  '校验剧情完整性（断链/结局规范/不可达节点/变量拼写/成就定义），附路径探索统计和非阻断 experienceWarnings。反复修订时传 compact:true，保留结论但省略长见证动作。',
  { title: z.string(), compact: z.boolean().optional() },
  wrap('story_validate', (args) => handlers.validateStory(args)),
)

server.tool(
  'story_upsert_achievement',
  '创建或覆盖一个成就定义（按 achievement.id）。achievement: {id, title, description, icon?, hidden?, when}，when 支持 #steps/#ending/#visited 特殊变量。',
  { title: z.string(), achievement: AchievementSchema },
  wrap('story_upsert_achievement', (args) => handlers.upsertAchievement(args)),
)

server.tool(
  'story_delete_achievement',
  '删除一个成就定义。',
  { title: z.string(), achievementId: z.string() },
  wrap('story_delete_achievement', (args) => handlers.deleteAchievement(args)),
)

server.tool(
  'story_upsert_document',
  '创建或覆盖一个线索/文档定义（按 document.id）。document: {id, title, text, kind?: rules|note|letter|doc}，节点用 effects.gainDocs 收集，玩家可在线索夹查看。',
  { title: z.string(), document: StoryDocumentSchema },
  wrap('story_upsert_document', (args) => handlers.upsertDocument(args)),
)

server.tool(
  'story_delete_document',
  '删除一个线索/文档定义。',
  { title: z.string(), documentId: z.string() },
  wrap('story_delete_document', (args) => handlers.deleteDocument(args)),
)

server.tool(
  'story_get_node',
  '读取单个完整节点及所有指向它的入边。局部审查或修稿优先使用本工具，避免 story_get 返回整部作品。',
  { title: z.string(), nodeId: z.string() },
  wrap('story_get_node', (args) => handlers.getNode(args)),
)

server.tool(
  'story_review_transitions',
  '分页返回紧凑的“源节点末段 → 选项 → response → 目标节点首段”审查包，用于检查选择关联、人物位置、因果与语气连续性。默认每页 20 条；先用 onlyRisks:true 处理缺承接及 response 重复目标开头，再分页人工连读其余边。',
  {
    title: z.string(),
    nodeIds: z.array(z.string()).max(50).optional(),
    onlyRisks: z.boolean().optional(),
    cursor: z.number().int().nonnegative().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  wrap('story_review_transitions', (args) => handlers.reviewProjectTransitions(args)),
)

server.tool(
  'story_patch_choice',
  '只修改一个选项，不覆盖整个节点。先从 story_get_node 或 story_review_transitions 取得 choiceIndex，并传 expectedLabel/expectedTarget 防止并行或过期索引误改；patch 可设置 label/response/target/when/effects，response/when/effects 传 null 表示删除。',
  {
    title: z.string(),
    nodeId: z.string(),
    choiceIndex: z.number().int().nonnegative(),
    expectedLabel: z.string().optional(),
    expectedTarget: z.string().optional(),
    patch: ChoicePatchSchema,
  },
  wrap('story_patch_choice', (args) => handlers.patchChoice(args)),
)

server.tool(
  'story_upsert_evidence',
  '创建或覆盖一条证据定义。节点用 effects.gainEvidence 获得证据，玩家可在线索板组合证据。',
  { title: z.string(), evidence: EvidenceSchema },
  wrap('story_upsert_evidence', (args) => handlers.upsertEvidence(args)),
)

server.tool(
  'story_delete_evidence',
  '删除一条证据定义；删除后请根据校验结果清理引用。',
  { title: z.string(), evidenceId: z.string() },
  wrap('story_delete_evidence', (args) => handlers.deleteEvidence(args)),
)

server.tool(
  'story_upsert_deduction',
  '创建或覆盖一个推论定义。requires.all 要求全部证据，requires.anyOf 的每组要求至少一条；hint 用于证据不足时提供非剧透调查方向。',
  { title: z.string(), deduction: DeductionSchema },
  wrap('story_upsert_deduction', (args) => handlers.upsertDeduction(args)),
)

server.tool(
  'story_delete_deduction',
  '删除一个推论定义。',
  { title: z.string(), deductionId: z.string() },
  wrap('story_delete_deduction', (args) => handlers.deleteDeduction(args)),
)

server.tool(
  'story_upsert_character',
  '创建或覆盖一个人物定义，包含关系维度与秘密。节点效果可调整关系、记录记忆和揭示秘密。',
  { title: z.string(), character: CharacterSchema },
  wrap('story_upsert_character', (args) => handlers.upsertCharacter(args)),
)

server.tool(
  'story_delete_character',
  '删除一个人物定义；删除后请根据校验结果清理关系与秘密引用。',
  { title: z.string(), characterId: z.string() },
  wrap('story_delete_character', (args) => handlers.deleteCharacter(args)),
)

server.tool(
  'story_upsert_puzzle',
  '创建或覆盖一个密码谜题，包含 actionLabel（场景行动文案）、答案、渐进提示、前置条件与成功效果；创建后还要在相关节点的 puzzles 中放置该谜题。',
  { title: z.string(), puzzle: PuzzleSchema },
  wrap('story_upsert_puzzle', (args) => handlers.upsertPuzzle(args)),
)

server.tool(
  'story_delete_puzzle',
  '删除一个谜题；删除后请根据校验结果清理 #puzzle 条件引用。',
  { title: z.string(), puzzleId: z.string() },
  wrap('story_delete_puzzle', (args) => handlers.deletePuzzle(args)),
)

server.tool(
  'story_walk',
  '路径探索与性能诊断：分别返回每个结局的可重放见证、条件软锁/无结局终点的失败见证、全状态覆盖完整性、预算利用率和热点节点。覆盖截断不等于已证明结局不可达，未发现失败也只有在 coverage 完整时才是完整结论。',
  {
    title: z.string(),
    maxStates: z.number().int().positive().optional(),
    maxDepth: z.number().int().positive().optional(),
    maxNodeVisits: z.number().int().positive().optional(),
    maxDeductionVariants: z.number().int().positive().optional(),
    witnessMaxStates: z.number().int().positive().optional(),
    diagnostics: z.boolean().optional(),
    topNodes: z.number().int().positive().max(50).optional(),
    compact: z.boolean().optional(),
  },
  wrap('story_walk', (args) => handlers.walkStory(args)),
)

server.tool(
  'story_evaluate',
  '快速评估作品体验与结构：返回选择承接、单选走廊、重复导航、机制回收、状态轴、声画覆盖和 walk 健康度等事实指标与候选问题；默认使用 1 万状态的诊断预算，不替代完整 story_walk。',
  {
    title: z.string(),
    maxStates: z.number().int().positive().optional(),
    witnessMaxStates: z.number().int().positive().optional(),
    compact: z.boolean().optional(),
  },
  wrap('story_evaluate', (args) => handlers.evaluateProject(args)),
)

server.tool(
  'story_graph',
  '生成 mermaid flowchart 分支图文本，便于直观审查剧情结构（可粘贴到 mermaid 渲染器）。',
  { title: z.string() },
  wrap('story_graph', (args) => handlers.graph(args.title)),
)

server.tool(
  'story_export',
  '把剧情导出为自包含单文件 HTML 游戏（双击即玩、零依赖、可发任何人）。校验未通过时拒绝导出。',
  {
    title: z.string(),
    outputDir: z.string().optional(),
  },
  wrap('story_export', (args) => handlers.exportStory(args)),
)

server.tool(
  'story_set_presentation',
  '用一次紧凑配置设置作品视觉表达。presentation 可选字段：shell=novel|dossier|chat|cinematic，typography=literary|modern|mono|rounded，density=compact|balanced|spacious，shape=sharp|soft|round，choiceStyle=buttons|list|dialogue|commands。只发送需要的字段；关键节点可用 node.presentation 覆盖差异项。',
  { title: z.string(), presentation: PresentationConfigSchema },
  wrap('story_set_presentation', (args) => handlers.setPresentation(args)),
)

server.tool(
  'story_set_meta',
  '更新项目元信息：副标题/作者/主题/HUD/初始声景，以及 world、phase 两条结构化状态轴。状态轴格式为 {initial, states:{状态id:{label?, theme?, presentation?, soundscape?}}}；用 choice/onEnter effects.world 或 effects.phase 切换，用 #world/#phase 条件控制选项。',
  {
    title: z.string(),
    subtitle: z.string().optional(),
    author: z.string().optional(),
    theme: z.union([z.string(), ThemeConfigSchema]).optional(),
    hud: z.array(HudStatSchema).optional(),
    presentation: PresentationConfigSchema.optional(),
    soundscape: SoundscapeSpecSchema.optional(),
    world: StateAxisConfigSchema.optional(),
    phase: StateAxisConfigSchema.optional(),
  },
  wrap('story_set_meta', (args) => handlers.setMeta(args)),
)

server.tool(
  'story_list',
  '列出所有已创建的游戏项目及节点/结局数量。',
  {},
  wrap('story_list', () => handlers.listProjects()),
)

server.tool(
  'story_delete_project',
  '删除整个游戏项目（不可恢复）。',
  { title: z.string() },
  wrap('story_delete_project', (args) => handlers.deleteProject(args.title)),
)

server.tool(
  'story_observability',
  '返回当前 MCP 进程的本地成本摘要：调用次数、失败、请求/响应字节、粗略 token、耗时、全量读取、校验、walk、导出与重复覆盖。只含聚合数字和资源 id，不保存剧情正文。',
  {},
  wrap('story_observability', async () => snapshotObservability(), false),
)

server.tool(
  'story_observability_reset',
  '清零当前 MCP 进程的成本观测窗口；用于开始一次可比较的盲测。',
  {},
  wrap('story_observability_reset', async () => {
    resetObservability()
    return { ok: true, reset: true }
  }, false),
)

/* ------------------------------ 启动 ------------------------------ */

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('TaleSpindle MCP server 启动失败:', err)
  process.exit(1)
})
