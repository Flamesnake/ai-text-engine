import { z } from 'zod'
import { SFX_NAMES, SOUNDSCAPE_NAMES } from './types.js'
import type {
  Achievement,
  Choice,
  ChoiceCard,
  Condition,
  Effects,
  Evidence,
  Deduction,
  Character,
  ChoiceTrace,
  Puzzle,
  PresentationConfig,
  EndingMeta,
  FxItem,
  GameState,
  HudStat,
  Story,
  StoryDocument,
  StoryMeta,
  StoryNode,
  StageCue,
  SiteConfig,
  TextSegment,
  TextBlock,
  ThemeConfig,
  WebPageMeta,
  VarValue,
  Vars,
} from './types.js'

/**
 * 共享 Story Schema（运行时真相源）。
 *
 * 统一用于：
 * - MCP 工具入参校验（server.ts 中替代 z.any()）；
 * - story.json 加载解析（projects.ts）；
 * - 存档恢复校验（engine.ts）；
 * - meta.version 版本迁移（migrateStory）；
 * - TypeScript 类型与 zod 结构在编译期对齐（各 Schema 显式标注 z.ZodType<T>）。
 *
 * 持久化读取 schema 保持「宽容」：未知字段被剥离、可选字段缺省，
 * 保证历史数据可继续读取；MCP 写入边界可使用对应 strict schema 拒绝新数据中的未知字段。
 */

/* ------------------------------ 基础 ------------------------------ */

export const VarValueSchema: z.ZodType<VarValue> = z.union([z.number(), z.string(), z.boolean()])

export const VarsSchema: z.ZodType<Vars> = z.record(z.string(), VarValueSchema)

export const ThemeConfigSchema: z.ZodType<ThemeConfig> = z.object({
  background: z.string(),
  card: z.string(),
  border: z.string(),
  borderGlow: z.string(),
  text: z.string(),
  textDim: z.string(),
  accent: z.string(),
  danger: z.string(),
  gold: z.string(),
  green: z.string(),
  purple: z.string(),
})

export const PresentationConfigSchema: z.ZodType<PresentationConfig> = z.object({
  shell: z.enum(['novel', 'dossier', 'chat', 'cinematic']).optional(),
  typography: z.enum(['literary', 'modern', 'mono', 'rounded']).optional(),
  density: z.enum(['compact', 'balanced', 'spacious']).optional(),
  shape: z.enum(['sharp', 'soft', 'round']).optional(),
  choiceStyle: z.enum(['buttons', 'list', 'dialogue', 'commands']).optional(),
  choiceReveal: z.enum(['none', 'fade', 'slide']).optional(),
  textReveal: z.enum(['instant', 'typewriter', 'terminal']).optional(),
}).strict()

const SITE_PERSONAS = [
  'broadsheet', 'local', 'wire', 'tabloid',
  'classic', 'modern', 'terminal',
  'folio', 'diary', 'editorial',
  'client', 'plain',
] as const

const PERSONA_BY_KIND: Record<string, string[]> = {
  news: ['broadsheet', 'local', 'wire', 'tabloid'],
  forum: ['classic', 'modern', 'terminal'],
  blog: ['folio', 'diary', 'editorial'],
  mail: ['client', 'plain'],
}

export const SiteConfigSchema: z.ZodType<SiteConfig> = z.object({
  kind: z.enum(['news', 'forum', 'blog', 'mail']),
  name: z.string().min(1).max(80),
  tagline: z.string().max(120).optional(),
  locale: z.string().max(40).optional(),
  persona: z.enum(SITE_PERSONAS).optional(),
}).strict().refine(
  (site) => site.persona === undefined || PERSONA_BY_KIND[site.kind].includes(site.persona),
  { message: 'persona 与 site.kind 不匹配', path: ['persona'] },
)

const LIST_LAYOUTS = ['frontpage', 'board', 'index', 'inbox'] as const

export const WebPageMetaSchema: z.ZodType<WebPageMeta> = z.object({
  layout: z.enum([
    'frontpage', 'article', 'bulletin',
    'board', 'thread', 'compose',
    'index', 'post', 'archive',
    'inbox', 'draft',
  ]).optional(),
  composition: z.enum(['single', 'lead-grid', 'lead-grid-sidebar', 'grid', 'feed']).optional(),
  section: z.string().max(40).optional(),
  headline: z.string().max(160).optional(),
  byline: z.string().max(60).optional(),
  timestamp: z.string().max(60).optional(),
}).strict()
  .refine((page) => Object.keys(page).length > 0, 'page 至少包含一个页面字段')
  .refine(
    (page) => page.composition === undefined || (page.layout !== undefined && (LIST_LAYOUTS as readonly string[]).includes(page.layout)),
    { message: 'composition 只对 frontpage/board/index/inbox 列表页生效', path: ['composition'] },
  )

export const HudStatSchema: z.ZodType<HudStat> = z.object({
  var: z.string(),
  label: z.string(),
  max: z.number().optional(),
  cap: z.number().optional(),
})

/* ------------------------------ 条件 / 效果 ------------------------------ */

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.object({
    var: z.string().optional(),
    op: z
      .enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'exists', 'has', 'not_has'])
      .optional(),
    value: VarValueSchema.optional(),
    and: z.array(ConditionSchema).optional(),
    or: z.array(ConditionSchema).optional(),
    not: ConditionSchema.optional(),
  }),
)

export const EffectsSchema: z.ZodType<Effects> = z.object({
  set: z.record(z.string(), VarValueSchema).optional(),
  add: z.record(z.string(), z.number()).optional(),
  rand: z.array(z.object({ var: z.string(), min: z.number(), max: z.number() })).optional(),
  violation: z.array(z.string()).optional(),
  day: z.number().optional(),
  world: z.string().min(1).optional(),
  phase: z.string().min(1).optional(),
  gain: z.array(z.string()).optional(),
  lose: z.array(z.string()).optional(),
  gainDocs: z.array(z.string()).optional(),
  gainEvidence: z.array(z.string()).optional(),
  adjustRelation: z.array(z.object({ characterId: z.string(), stat: z.string(), add: z.number() })).optional(),
  remember: z.array(z.string()).optional(),
  revealSecrets: z.array(z.string()).optional(),
  flag: z.record(z.string(), z.boolean()).optional(),
})

/* ------------------------------ 文本块 / 文档 ------------------------------ */

const TEXT_BLOCK_TYPES = ['para', 'title', 'rules', 'note', 'letter'] as const
const TEXT_SEGMENT_STYLES = [
  'emphasis', 'italic', 'blood', 'whisper', 'redacted',
  'glitch', 'corrupt', 'terminal', 'handwritten', 'broadcast',
] as const

export const TextSegmentSchema: z.ZodType<TextSegment> = z.object({
  text: z.string(),
  style: z.enum(TEXT_SEGMENT_STYLES).optional(),
  revealWhen: ConditionSchema.optional(),
}).strict()

export const TextBlockSchema: z.ZodType<TextBlock> = z.object({
  type: z.enum(TEXT_BLOCK_TYPES).optional(),
  text: z.string(),
  segments: z.array(TextSegmentSchema).optional(),
  title: z.string().optional(),
})

export const StoryDocumentSchema: z.ZodType<StoryDocument> = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum([...TEXT_BLOCK_TYPES, 'doc']).optional(),
  text: z.string(),
})

export const EvidenceSchema: z.ZodType<Evidence> = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  kind: z.enum(['document', 'object', 'testimony', 'observation']).optional(),
  source: z.string().optional(),
})

export const DeductionSchema: z.ZodType<Deduction> = z.object({
  id: z.string(),
  statement: z.string(),
  description: z.string().optional(),
  hint: z.string().optional(),
  requires: z.object({
    all: z.array(z.string()).optional(),
    anyOf: z.array(z.array(z.string())).optional(),
  }),
  onConfirmed: EffectsSchema.optional(),
})

export const CharacterSchema: z.ZodType<Character> = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  relations: z.record(z.string(), z.object({
    label: z.string(), initial: z.number().optional(), min: z.number().optional(), max: z.number().optional(),
  })).optional(),
  secrets: z.record(z.string(), z.object({
    id: z.string(), title: z.string(), description: z.string(),
  })).optional(),
})

export const PuzzleSchema: z.ZodType<Puzzle> = z.object({
  id: z.string(),
  title: z.string(),
  actionLabel: z.string().optional(),
  prompt: z.string(),
  kind: z.literal('code'),
  solution: z.string(),
  caseSensitive: z.boolean().optional(),
  hints: z.array(z.string()).optional(),
  requires: ConditionSchema.optional(),
  onSolved: EffectsSchema.optional(),
})

/* ------------------------------ 节点 / 选项 / 结局 / 成就 ------------------------------ */

const FX_NAMES = ['shake', 'flicker', 'glitch', 'pulse', 'unstable', 'spotlight'] as const

export const FxSpecSchema = z.object({
  name: z.enum(FX_NAMES),
  intensity: z.number().min(0.1).max(2).optional(),
  speed: z.number().min(0.25).max(4).optional(),
  sway: z.boolean().optional(),
  flicker: z.boolean().optional(),
}).refine(
  (fx) => (fx.sway === undefined && fx.flicker === undefined) || fx.name === 'spotlight',
  { message: 'sway/flicker 只对 spotlight 效果有效' },
)

export const FxItemSchema: z.ZodType<FxItem> = z.union([z.enum(FX_NAMES), FxSpecSchema])

export const StageCueSchema: z.ZodType<StageCue> = z.object({
  backdrop: z.enum(['neutral', 'interior', 'exterior', 'shore', 'industrial', 'archive', 'void']).optional(),
  lighting: z.enum(['natural', 'warm', 'cool', 'night', 'alert', 'blackout', 'spotlight']).optional(),
  camera: z.enum(['wide', 'medium', 'close', 'push']).optional(),
  actors: z.array(z.object({
    characterId: z.string().min(1),
    position: z.enum(['left', 'center', 'right']),
    pose: z.enum(['neutral', 'open', 'guarded', 'tense', 'afraid', 'angry', 'sad', 'shadow']).optional(),
    focus: z.boolean().optional(),
    entrance: z.enum(['none', 'fade', 'slide', 'rise']).optional(),
  }).strict()).max(3).optional(),
}).strict().refine((cue) => Object.keys(cue).length > 0, 'stage cue 至少包含一个变化字段')

export const SoundscapeSpecSchema = z.object({
  name: z.enum(SOUNDSCAPE_NAMES),
  intensity: z.enum(['subtle', 'medium', 'strong']).optional(),
}).strict()

export const StateAppearanceSchema = z.object({
  label: z.string().optional(),
  theme: z.union([z.string(), ThemeConfigSchema]).optional(),
  presentation: PresentationConfigSchema.optional(),
  soundscape: z.union([SoundscapeSpecSchema, z.literal('silence')]).optional(),
}).strict()

export const StateAxisConfigSchema = z.object({
  initial: z.string().min(1),
  states: z.record(z.string(), StateAppearanceSchema),
}).strict()

export const ChoiceCardSchema: z.ZodType<ChoiceCard> = z.object({
  slot: z.enum(['lead', 'grid', 'sidebar', 'feed']).optional(),
  summary: z.string().max(200).optional(),
  media: z.enum(['photo', 'document', 'map', 'chart', 'signal']).optional(),
  badge: z.string().max(20).optional(),
}).strict().refine((card) => Object.keys(card).length > 0, 'card 至少包含一个字段')

export const ChoiceSchema: z.ZodType<Choice> = z.object({
  label: z.string(),
  response: z.string().optional(),
  target: z.string(),
  when: ConditionSchema.optional(),
  effects: EffectsSchema.optional(),
  card: ChoiceCardSchema.optional(),
})

export interface ChoicePatch {
  label?: string
  response?: string | null
  target?: string
  when?: Condition | null
  effects?: Effects | null
}

export const ChoicePatchSchema: z.ZodType<ChoicePatch> = z.object({
  label: z.string().min(1).optional(),
  response: z.string().nullable().optional(),
  target: z.string().min(1).optional(),
  when: ConditionSchema.nullable().optional(),
  effects: EffectsSchema.nullable().optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, 'patch 至少包含一个字段')

export const ChoiceTraceSchema: z.ZodType<ChoiceTrace> = z.object({
  fromNodeId: z.string(),
  targetNodeId: z.string(),
  label: z.string(),
  response: z.string().optional(),
})

export const EndingMetaSchema: z.ZodType<EndingMeta> = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(['good', 'bad', 'true', 'hidden']),
})

export const StoryNodeSchema = z.object({
  id: z.string(),
  objective: z.string().optional(),
  text: z.string(),
  blocks: z.array(TextBlockSchema).optional(),
  sfx: z.enum(SFX_NAMES).optional(),
  soundscape: z.union([SoundscapeSpecSchema, z.literal('silence')]).optional(),
  fx: z.array(FxItemSchema).optional(),
  presentation: PresentationConfigSchema.optional(),
  stage: z.union([StageCueSchema, z.literal('clear')]).optional(),
  page: WebPageMetaSchema.optional(),
  choices: z.array(ChoiceSchema),
  puzzles: z.array(z.string()).optional(),
  ending: EndingMetaSchema.optional(),
  onEnter: EffectsSchema.optional(),
  tags: z.array(z.string()).optional(),
  note: z.string().optional(),
}) satisfies z.ZodType<StoryNode>

/** MCP 写入专用：拒绝未知字段，避免拼错或把 effects 放到节点顶层后静默失效。 */
export const StrictStoryNodeSchema: z.ZodType<StoryNode> = StoryNodeSchema.strict()

export const AchievementSchema: z.ZodType<Achievement> = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  icon: z.string().optional(),
  hidden: z.boolean().optional(),
  when: ConditionSchema,
})

/* ------------------------------ 剧情 / 存档 ------------------------------ */

export const StoryMetaSchema: z.ZodType<StoryMeta> = z.object({
  title: z.string(),
  uid: z.string().optional(),
  subtitle: z.string().optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  theme: z.union([z.string(), ThemeConfigSchema]).optional(),
  presentation: PresentationConfigSchema.optional(),
  site: SiteConfigSchema.optional(),
  soundscape: SoundscapeSpecSchema.optional(),
  world: StateAxisConfigSchema.optional(),
  phase: StateAxisConfigSchema.optional(),
  hud: z.array(HudStatSchema).optional(),
})

export const StorySchema: z.ZodType<Story> = z.object({
  meta: StoryMetaSchema,
  start: z.string(),
  nodes: z.record(z.string(), StoryNodeSchema),
  endings: z.record(z.string(), EndingMetaSchema),
  achievements: z.array(AchievementSchema).optional(),
  documents: z.record(z.string(), StoryDocumentSchema).optional(),
  evidence: z.record(z.string(), EvidenceSchema).optional(),
  deductions: z.record(z.string(), DeductionSchema).optional(),
  characters: z.record(z.string(), CharacterSchema).optional(),
  puzzles: z.record(z.string(), PuzzleSchema).optional(),
})

export const GameStateSchema: z.ZodType<GameState> = z.object({
  saveVersion: z.number().int().positive().optional(),
  nodeId: z.string(),
  lastChoice: ChoiceTraceSchema.nullable().default(null),
  history: z.array(z.string()),
  visited: z.array(z.string()),
  vars: VarsSchema,
  inventory: z.array(z.string()),
  docs: z.array(z.string()),
  evidence: z.array(z.string()).default([]),
  deductions: z.array(z.string()).default([]),
  relations: z.record(z.string(), z.record(z.string(), z.number())).default({}),
  memories: z.array(z.string()).default([]),
  revealedSecrets: z.array(z.string()).default([]),
  solvedPuzzles: z.array(z.string()).default([]),
  puzzleAttempts: z.record(z.string(), z.number()).default({}),
  puzzleHints: z.record(z.string(), z.number()).default({}),
  tutorialsSeen: z.array(z.string()).default([]),
  violations: z.array(z.string()),
  day: z.number(),
  world: z.string().default('default'),
  phase: z.string().default('default'),
  achievements: z.array(z.string()),
  endingId: z.string().nullable(),
  updatedAt: z.number(),
})

/* ------------------------------ 解析 / 迁移 ------------------------------ */

/** 当前 Schema 版本（写入 Story.meta.version） */
export const SCHEMA_VERSION = '0.8.0'

/** schema 校验失败时的可读错误 */
export class StorySchemaError extends Error {
  constructor(issues: z.ZodIssue[] | string) {
    super(
      typeof issues === 'string'
        ? issues
        : `story 数据不符合 schema（${issues.length} 处）：${issues
            .map((i) => `${i.path.length > 0 ? i.path.join('.') : '<root>'}: ${i.message}`)
            .join('; ')}`,
    )
    this.name = 'StorySchemaError'
  }
}

/**
 * 版本迁移：把任意历史版本的数据规整到当前 Schema 可接受的形式。
 * 当前只保证 meta.version 存在；未来格式变更时在此按 version 分叉迁移。
 */
export function migrateStory(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const story = raw as { meta?: { version?: unknown } }
  if (story.meta && typeof story.meta === 'object') {
    if (story.meta.version === undefined || story.meta.version === null || story.meta.version === '') {
      story.meta.version = SCHEMA_VERSION
    }
  }
  return raw
}

/** 解析 story 数据（含版本迁移；接受 JSON 字符串或已解析对象）；失败抛 StorySchemaError */
export function parseStory(raw: unknown): Story {
  const data = parseJsonIfNeeded(raw)
  const result = StorySchema.safeParse(migrateStory(data))
  if (!result.success) throw new StorySchemaError(result.error.issues)
  return result.data
}

/** 解析存档数据；失败抛 StorySchemaError */
export function parseGameState(raw: unknown): GameState {
  const result = GameStateSchema.safeParse(raw)
  if (!result.success) throw new StorySchemaError(result.error.issues)
  return result.data
}

function parseJsonIfNeeded(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    throw new StorySchemaError('story 数据不是合法 JSON 字符串')
  }
}
