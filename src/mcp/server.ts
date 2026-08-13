import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import * as handlers from './handlers.js'
import {
  AchievementSchema,
  HudStatSchema,
  StoryDocumentSchema,
  StoryNodeSchema,
  ThemeConfigSchema,
  EvidenceSchema,
  DeductionSchema,
  CharacterSchema,
  PuzzleSchema,
} from '../core/schema.js'

/**
 * ai-text-engine MCP 服务器（stdio）。
 * 让 AI 客户端通过工具操作引擎：创建项目、编辑节点、校验、导出单文件 HTML。
 *
 * 启动：npm run mcp （或 node dist/mcp/server.js）
 * 注册：在 .mcp.json 的 mcpServers 中引用本服务器。
 */

const server = new McpServer({
  name: 'ai-text-engine',
  version: '0.1.0',
})

/** 统一包装：结果 JSON 序列化；异常转为 isError 响应 */
function wrap(handler: (args: any) => Promise<unknown>) {
  return async (args: any) => {
    try {
      const result = await handler(args)
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
  wrap((args) => handlers.newProject(args)),
)

server.tool(
  'story_get',
  '读取整个剧情的完整 JSON（含所有节点/选项/结局/条件/效果）。',
  { title: z.string() },
  wrap((args) => handlers.getStory(args.title)),
)

server.tool(
  'story_upsert_node',
  '创建或覆盖一个节点（按 node.id）。node 为完整节点对象：{id, text, choices[], ending?, onEnter?, tags?, note?}。写入后自动返回校验结果。',
  { title: z.string(), node: StoryNodeSchema },
  wrap((args) => handlers.upsertNode(args)),
)

server.tool(
  'story_delete_node',
  '删除节点。若仍有其他选项指向它且未传 force，将报错列出引用处；force:true 会强行删除（可能产生断链）。',
  {
    title: z.string(),
    nodeId: z.string(),
    force: z.boolean().optional(),
  },
  wrap((args) => handlers.deleteNode(args)),
)

server.tool(
  'story_delete_ending',
  '从结局表删除一个结局（若有节点仍使用它则报错）。创建项目时自带的示例结局可用此工具清理。',
  { title: z.string(), endingId: z.string() },
  wrap((args) => handlers.deleteEnding(args)),
)

server.tool(
  'story_validate',
  '校验剧情完整性（断链/结局规范/不可达节点/变量拼写/成就定义）并附路径探索模拟统计（各结局可达路径与最短步数）。',
  { title: z.string() },
  wrap((args) => handlers.validateStory(args.title)),
)

server.tool(
  'story_upsert_achievement',
  '创建或覆盖一个成就定义（按 achievement.id）。achievement: {id, title, description, icon?, hidden?, when}，when 支持 #steps/#ending/#visited 特殊变量。',
  { title: z.string(), achievement: AchievementSchema },
  wrap((args) => handlers.upsertAchievement(args)),
)

server.tool(
  'story_delete_achievement',
  '删除一个成就定义。',
  { title: z.string(), achievementId: z.string() },
  wrap((args) => handlers.deleteAchievement(args)),
)

server.tool(
  'story_upsert_document',
  '创建或覆盖一个线索/文档定义（按 document.id）。document: {id, title, text, kind?: rules|note|letter|doc}，节点用 effects.gainDocs 收集，玩家可在线索夹查看。',
  { title: z.string(), document: StoryDocumentSchema },
  wrap((args) => handlers.upsertDocument(args)),
)

server.tool(
  'story_delete_document',
  '删除一个线索/文档定义。',
  { title: z.string(), documentId: z.string() },
  wrap((args) => handlers.deleteDocument(args)),
)

server.tool(
  'story_upsert_evidence',
  '创建或覆盖一条证据定义。节点用 effects.gainEvidence 获得证据，玩家可在线索板组合证据。',
  { title: z.string(), evidence: EvidenceSchema },
  wrap((args) => handlers.upsertEvidence(args)),
)

server.tool(
  'story_delete_evidence',
  '删除一条证据定义；删除后请根据校验结果清理引用。',
  { title: z.string(), evidenceId: z.string() },
  wrap((args) => handlers.deleteEvidence(args)),
)

server.tool(
  'story_upsert_deduction',
  '创建或覆盖一个推论定义。requires.all 要求全部证据，requires.anyOf 的每组要求至少一条。',
  { title: z.string(), deduction: DeductionSchema },
  wrap((args) => handlers.upsertDeduction(args)),
)

server.tool(
  'story_delete_deduction',
  '删除一个推论定义。',
  { title: z.string(), deductionId: z.string() },
  wrap((args) => handlers.deleteDeduction(args)),
)

server.tool(
  'story_upsert_character',
  '创建或覆盖一个人物定义，包含关系维度与秘密。节点效果可调整关系、记录记忆和揭示秘密。',
  { title: z.string(), character: CharacterSchema },
  wrap((args) => handlers.upsertCharacter(args)),
)

server.tool(
  'story_delete_character',
  '删除一个人物定义；删除后请根据校验结果清理关系与秘密引用。',
  { title: z.string(), characterId: z.string() },
  wrap((args) => handlers.deleteCharacter(args)),
)

server.tool(
  'story_upsert_puzzle',
  '创建或覆盖一个密码谜题，包含答案、渐进提示、前置条件与成功效果。',
  { title: z.string(), puzzle: PuzzleSchema },
  wrap((args) => handlers.upsertPuzzle(args)),
)

server.tool(
  'story_delete_puzzle',
  '删除一个谜题；删除后请根据校验结果清理 #puzzle 条件引用。',
  { title: z.string(), puzzleId: z.string() },
  wrap((args) => handlers.deletePuzzle(args)),
)

server.tool(
  'story_walk',
  '路径探索模拟：统计每个结局的到达路径数与最短步数、未到达的结局、疑似条件循环警告。',
  { title: z.string() },
  wrap((args) => handlers.validateStory(args.title)),
)

server.tool(
  'story_graph',
  '生成 mermaid flowchart 分支图文本，便于直观审查剧情结构（可粘贴到 mermaid 渲染器）。',
  { title: z.string() },
  wrap((args) => handlers.graph(args.title)),
)

server.tool(
  'story_export',
  '把剧情导出为自包含单文件 HTML 游戏（双击即玩、零依赖、可发任何人）。校验未通过时拒绝导出。',
  {
    title: z.string(),
    outputDir: z.string().optional(),
  },
  wrap((args) => handlers.exportStory(args)),
)

server.tool(
  'story_set_meta',
  '更新项目的元信息：副标题/作者/主题（内置名 dark|cyber|cozy|paper 或自定义配色对象）/HUD 统计条（好感度等）。',
  {
    title: z.string(),
    subtitle: z.string().optional(),
    author: z.string().optional(),
    theme: z.union([z.string(), ThemeConfigSchema]).optional(),
    hud: z.array(HudStatSchema).optional(),
  },
  wrap((args) => handlers.setMeta(args)),
)

server.tool(
  'story_list',
  '列出所有已创建的游戏项目及节点/结局数量。',
  {},
  wrap(() => handlers.listProjects()),
)

server.tool(
  'story_delete_project',
  '删除整个游戏项目（不可恢复）。',
  { title: z.string() },
  wrap((args) => handlers.deleteProject(args.title)),
)

/* ------------------------------ 启动 ------------------------------ */

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('ai-text-engine MCP server 启动失败:', err)
  process.exit(1)
})
