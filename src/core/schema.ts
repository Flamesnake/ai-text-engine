import { z } from 'zod'
import type {
  Achievement,
  Choice,
  Condition,
  Effects,
  Evidence,
  Deduction,
  Character,
  Puzzle,
  EndingMeta,
  FxItem,
  GameState,
  HudStat,
  Story,
  StoryDocument,
  StoryMeta,
  StoryNode,
  TextBlock,
  ThemeConfig,
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
 * 所有 schema 保持「宽容」：未知字段被剥离、可选字段缺省，
 * 保证历史数据与 AI 生成数据都能被接受。
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

export const TextBlockSchema: z.ZodType<TextBlock> = z.object({
  type: z.enum(TEXT_BLOCK_TYPES).optional(),
  text: z.string(),
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

const FX_NAMES = ['shake', 'flicker', 'glitch', 'pulse', 'unstable'] as const

export const FxSpecSchema = z.object({
  name: z.enum(FX_NAMES),
  intensity: z.number().optional(),
  speed: z.number().optional(),
})

export const FxItemSchema: z.ZodType<FxItem> = z.union([z.enum(FX_NAMES), FxSpecSchema])

export const ChoiceSchema: z.ZodType<Choice> = z.object({
  label: z.string(),
  target: z.string(),
  when: ConditionSchema.optional(),
  effects: EffectsSchema.optional(),
})

export const EndingMetaSchema: z.ZodType<EndingMeta> = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(['good', 'bad', 'true', 'hidden']),
})

export const StoryNodeSchema: z.ZodType<StoryNode> = z.object({
  id: z.string(),
  text: z.string(),
  blocks: z.array(TextBlockSchema).optional(),
  sfx: z.string().optional(),
  fx: z.array(FxItemSchema).optional(),
  choices: z.array(ChoiceSchema),
  puzzles: z.array(z.string()).optional(),
  ending: EndingMetaSchema.optional(),
  onEnter: EffectsSchema.optional(),
  tags: z.array(z.string()).optional(),
  note: z.string().optional(),
})

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
  subtitle: z.string().optional(),
  version: z.string().optional(),
  author: z.string().optional(),
  theme: z.union([z.string(), ThemeConfigSchema]).optional(),
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
  nodeId: z.string(),
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
  violations: z.array(z.string()),
  day: z.number(),
  achievements: z.array(z.string()),
  endingId: z.string().nullable(),
  updatedAt: z.number(),
})

/* ------------------------------ 解析 / 迁移 ------------------------------ */

/** 当前 Schema 版本（写入 Story.meta.version） */
export const SCHEMA_VERSION = '0.4.0'

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
