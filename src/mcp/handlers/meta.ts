import path from 'node:path'
import { z } from 'zod'
import { validate, validateExperience } from '../../core/validate.js'
import { evaluateStory } from '../../core/evaluate.js'
import { walkAllEndings, type WalkOptions, type WalkResult } from '../../core/walk.js'
import { exportToHtml } from '../../export/exporter.js'
import type { HudStat, PresentationConfig, SiteConfig, SoundscapeSpec, StateAxisConfig, ThemeConfig } from '../../core/types.js'
import {
  HudStatSchema,
  PresentationConfigSchema,
  SiteConfigSchema,
  SoundscapeSpecSchema,
  StateAxisConfigSchema,
  ThemeConfigSchema,
} from '../../core/schema.js'
import * as projects from '../projects.js'
import { resetObservability, snapshotObservability } from '../observability.js'
import type { ToolDef } from '../tool-def.js'

/**
 * 元信息 / 诊断 / 导出域：meta 设置、校验、walk、评估、图、导出、项目列表与删除、观测。
 */

export interface ValidateStoryArgs {
  title: string
  /** 调试时省略长见证动作；结论、预算、热点与见证步数仍保留。 */
  compact?: boolean
}

export async function validateStory(args: string | ValidateStoryArgs): Promise<unknown> {
  const normalized = typeof args === 'string' ? { title: args, compact: false } : args
  const story = await projects.loadStory(normalized.title)
  const problems = validate(story)
  const walk = walkAllEndings(story)
  const experienceWarnings = validateExperience(story)
  return {
    ok: true,
    title: normalized.title,
    compact: normalized.compact ?? false,
    validatePass: problems.length === 0,
    problems,
    experienceWarnings,
    nodeCount: Object.keys(story.nodes).length,
    endingCount: Object.keys(story.endings).length,
    walk: normalized.compact ? compactWalkResult(walk) : walk,
  }
}

/** 生成 mermaid flowchart 便于 AI 审查分支结构 */
export async function graph(title: string): Promise<unknown> {
  const story = await projects.loadStory(title)
  const lines: string[] = ['flowchart TD']
  const safeId = (id: string): string => id.replace(/[^A-Za-z0-9_]/g, '_') || 'node'
  const q = (s: string): string => `"${s.replace(/"/g, '&quot;').replace(/\n/g, ' ')}"`
  const seen = new Set<string>()

  for (const node of Object.values(story.nodes)) {
    const id = safeId(node.id)
    if (node.choices.length === 0 && node.ending) {
      lines.push(`  ${id}{{${q(`${node.ending.title} (${node.ending.kind})`)}}}`)
      seen.add(id)
      continue
    }
    lines.push(`  ${id}[${q(node.id)}]`)
    seen.add(id)
    for (const c of node.choices) {
      const target = safeId(c.target)
      const cond = c.when ? ' ?' : ''
      lines.push(`  ${id} -->|${q(c.label + cond)}| ${target}`)
    }
  }
  lines.push(`  start[${q('START: ' + story.meta.title)}]`)
  lines.push(`  start -.-> ${safeId(story.start)}`)
  return { ok: true, title, mermaid: lines.join('\n'), nodeCount: seen.size }
}

export interface ExportArgs {
  title: string
  outputDir?: string
}

export async function exportStory(args: ExportArgs): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  const problems = validate(story)
  if (problems.length > 0) {
    return {
      ok: false,
      message: '剧情校验未通过，请先用 story_validate 修复后再导出',
      problems,
    }
  }
  const result = await exportToHtml(story, {
    // 默认导出到项目目录下，与项目存储根保持一致
    outputDir: args.outputDir ?? path.join(await projects.resolveProjectDir(args.title), 'dist'),
  })
  return {
    ok: true,
    outputPath: result.outputPath,
    sizeBytes: result.sizeBytes,
    nodeCount: result.nodeCount,
    endingCount: result.endingCount,
    hint: '用浏览器打开 outputPath 即可游玩；可发给任何人，无需安装任何东西',
  }
}

export async function setMeta(args: {
  title: string
  subtitle?: string
  author?: string
  theme?: string | ThemeConfig
  hud?: HudStat[]
  presentation?: PresentationConfig
  site?: SiteConfig
  soundscape?: SoundscapeSpec
  world?: StateAxisConfig
  phase?: StateAxisConfig
}): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  if (args.subtitle !== undefined) story.meta.subtitle = args.subtitle
  if (args.author !== undefined) story.meta.author = args.author
  if (args.theme !== undefined) story.meta.theme = args.theme
  if (args.hud !== undefined) story.meta.hud = args.hud
  if (args.presentation !== undefined) story.meta.presentation = args.presentation
  if (args.site !== undefined) story.meta.site = args.site
  if (args.soundscape !== undefined) story.meta.soundscape = args.soundscape
  if (args.world !== undefined) story.meta.world = args.world
  if (args.phase !== undefined) story.meta.phase = args.phase
  await projects.saveStory(story)
  return { ok: true, meta: story.meta }
}

/** 单独的紧凑视觉配置工具，避免为改外观重复发送其他 meta 字段。 */
export async function setPresentation(args: {
  title: string
  presentation: PresentationConfig
}): Promise<unknown> {
  return setMeta({ title: args.title, presentation: args.presentation })
}

export interface EvaluateProjectArgs {
  title: string
  /** 体验评估默认使用较小预算；完整可达性证明请调用 story_walk。 */
  maxStates?: number
  witnessMaxStates?: number
  /** 省略评估内嵌 walk 的长见证动作，适合反复修订。 */
  compact?: boolean
}

export async function evaluateProject(args: EvaluateProjectArgs | string): Promise<unknown> {
  const normalized = typeof args === 'string' ? { title: args } : args
  const story = await projects.loadStory(normalized.title)
  const evaluation = evaluateStory(story, {
    walkOptions: {
      maxStates: normalized.maxStates ?? 10_000,
      witnessMaxStates: normalized.witnessMaxStates ?? 5_000,
    },
  })
  return {
    ok: true,
    title: normalized.title,
    evaluationScope: 'quick_diagnostic',
    evaluation: normalized.compact
      ? { ...evaluation, performance: { walk: compactWalkResult(evaluation.performance.walk) } }
      : evaluation,
  }
}

export interface WalkStoryArgs extends Omit<WalkOptions, 'rand' | 'targetEndingId'> {
  title: string
  /** 省略长见证动作；最终 DOM 重放前再请求完整输出。 */
  compact?: boolean
}

/** 独立路径诊断：允许调整探索预算，并默认返回热点节点以减少盲目改稿。 */
export async function walkStory(args: WalkStoryArgs): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  const { title, compact = false, ...options } = args
  const walk = walkAllEndings(story, {
    ...options,
    diagnostics: options.diagnostics ?? true,
  })
  return {
    ok: true,
    title,
    compact,
    nodeCount: Object.keys(story.nodes).length,
    endingCount: Object.keys(story.endings).length,
    walk: compact ? compactWalkResult(walk) : walk,
  }
}

export function compactWalkResult(walk: WalkResult): Omit<WalkResult, 'reachability' | 'failures'> & {
  reachability: Omit<WalkResult['reachability'], 'witnesses'> & {
    witnesses: Array<Omit<WalkResult['reachability']['witnesses'][number], 'actions'> & { actionCount: number }>
  }
  failures: Omit<WalkResult['failures'], 'witnesses'> & {
    witnesses: Array<Omit<WalkResult['failures']['witnesses'][number], 'actions'> & { actionCount: number }>
  }
} {
  return {
    ...walk,
    reachability: {
      ...walk.reachability,
      witnesses: walk.reachability.witnesses.map(({ actions, ...witness }) => ({
        ...witness,
        actionCount: actions.length,
      })),
    },
    failures: {
      ...walk.failures,
      witnesses: walk.failures.witnesses.map(({ actions, ...witness }) => ({
        ...witness,
        actionCount: actions.length,
      })),
    },
  }
}

export async function listProjects(): Promise<unknown> {
  const refs = await projects.listProjects()
  const detailed = []
  for (const ref of refs) {
    try {
      const story = await projects.loadStory(ref.title)
      detailed.push({
        name: ref.dir,
        title: story.meta.title,
        nodes: Object.keys(story.nodes).length,
        endings: Object.keys(story.endings).length,
      })
    } catch {
      detailed.push({ name: ref.dir, title: ref.title })
    }
  }
  return { ok: true, projects: detailed }
}

export async function deleteProject(title: string): Promise<unknown> {
  await projects.deleteProject(title)
  return { ok: true, deleted: title }
}

export const META_TOOLS: ToolDef[] = [
  {
    name: 'story_validate',
    description: '校验剧情完整性（断链/结局规范/不可达节点/变量拼写/成就定义），附路径探索统计和非阻断 experienceWarnings。反复修订时传 compact:true，保留结论但省略长见证动作。',
    schema: { title: z.string(), compact: z.boolean().optional() },
    handler: (args) => validateStory(args),
  },
  {
    name: 'story_walk',
    description: '路径探索与性能诊断：分别返回每个结局的可重放见证、条件软锁/无结局终点的失败见证、全状态覆盖完整性、预算利用率和热点节点。覆盖截断不等于已证明结局不可达，未发现失败也只有在 coverage 完整时才是完整结论。',
    schema: {
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
    handler: (args) => walkStory(args),
  },
  {
    name: 'story_evaluate',
    description: '快速评估作品体验与结构：返回选择承接、单选走廊、重复导航、机制回收、状态轴、声画覆盖和 walk 健康度等事实指标与候选问题；默认使用 1 万状态的诊断预算，不替代完整 story_walk。',
    schema: {
      title: z.string(),
      maxStates: z.number().int().positive().optional(),
      witnessMaxStates: z.number().int().positive().optional(),
      compact: z.boolean().optional(),
    },
    handler: (args) => evaluateProject(args),
  },
  {
    name: 'story_graph',
    description: '生成 mermaid flowchart 分支图文本，便于直观审查剧情结构（可粘贴到 mermaid 渲染器）。',
    schema: { title: z.string() },
    handler: (args) => graph(args.title),
  },
  {
    name: 'story_export',
    description: '把剧情导出为自包含单文件 HTML 游戏（双击即玩、零依赖、可发任何人）。校验未通过时拒绝导出。',
    schema: { title: z.string(), outputDir: z.string().optional() },
    handler: (args) => exportStory(args),
  },
  {
    name: 'story_set_presentation',
    description: '用一次紧凑配置设置作品视觉表达。presentation 可选字段：shell=novel|dossier|chat|cinematic，typography=literary|modern|mono|rounded，density=compact|balanced|spacious，shape=sharp|soft|round，choiceStyle=buttons|list|dialogue|commands，choiceReveal=none|fade|slide（选项依次淡入/上浮，默认 fade），textReveal=instant|typewriter|terminal（正文逐字/仿终端，默认 instant，点击或 Enter 补全）。只发送需要的字段；关键节点可用 node.presentation 覆盖差异项。',
    schema: { title: z.string(), presentation: PresentationConfigSchema },
    handler: (args) => setPresentation(args),
  },
  {
    name: 'story_set_meta',
    description: '更新项目元信息：副标题/作者/主题/HUD/初始声景、拟态网站 site，以及 world、phase 两条结构化状态轴。site 支持 {kind:"news"|"forum"|"blog"|"mail",name,tagline?,locale?,persona?}，persona 需匹配 kind（news: broadsheet/local/wire/tabloid；forum: classic/modern/terminal；blog: folio/diary/editorial；mail: client/plain）。节点用 page 补页面语义（news: frontpage/article/bulletin；forum: board/thread/compose；blog: index/post/archive；mail: inbox/thread/draft），列表页可加 composition；choice 可加 card:{slot?,summary?,media?,badge?} 呈现为新闻卡片/帖子行/邮件行，所有导航继续使用 choices。状态轴格式为 {initial, states:{状态id:{label?, theme?, presentation?, soundscape?}}}；用 choice/onEnter effects.world 或 effects.phase 切换，用 #world/#phase 条件控制选项。',
    schema: {
      title: z.string(),
      subtitle: z.string().optional(),
      author: z.string().optional(),
      theme: z.union([z.string(), ThemeConfigSchema]).optional(),
      hud: z.array(HudStatSchema).optional(),
      presentation: PresentationConfigSchema.optional(),
      site: SiteConfigSchema.optional(),
      soundscape: SoundscapeSpecSchema.optional(),
      world: StateAxisConfigSchema.optional(),
      phase: StateAxisConfigSchema.optional(),
    },
    handler: (args) => setMeta(args),
  },
  {
    name: 'story_list',
    description: '列出所有已创建的游戏项目及节点/结局数量。',
    schema: {},
    handler: () => listProjects(),
  },
  {
    name: 'story_delete_project',
    description: '删除整个游戏项目（不可恢复）。',
    schema: { title: z.string() },
    handler: (args) => deleteProject(args.title),
  },
  {
    name: 'story_observability',
    description: '返回当前 MCP 进程的本地成本摘要：调用次数、失败、请求/响应字节、粗略 token、耗时、全量读取、校验、walk、导出与重复覆盖。只含聚合数字和资源 id，不保存剧情正文。',
    schema: {},
    handler: async () => snapshotObservability(),
    observe: false,
  },
  {
    name: 'story_observability_reset',
    description: '清零当前 MCP 进程的成本观测窗口；用于开始一次可比较的盲测。',
    schema: {},
    handler: async () => {
      resetObservability()
      return { ok: true, reset: true }
    },
    observe: false,
  },
]