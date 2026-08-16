import { z } from 'zod'
import { validate } from '../../core/validate.js'
import type { Achievement, Deduction, Evidence, Puzzle, StoryDocument } from '../../core/types.js'
import {
  AchievementSchema,
  DeductionSchema,
  EvidenceSchema,
  PuzzleSchema,
  StoryDocumentSchema,
} from '../../core/schema.js'
import * as projects from '../projects.js'
import type { ToolDef } from '../tool-def.js'

/**
 * 机制资源域：证据 / 推论 / 谜题 / 文档 / 成就 的增删。
 */

export interface UpsertAchievementArgs {
  title: string
  achievement: Achievement
}

export async function upsertAchievement(args: UpsertAchievementArgs): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  const ach = args.achievement
  if (!ach?.id) throw new Error('achievement.id 不能为空')
  story.achievements ??= []
  const isNew = !story.achievements.some((a) => a.id === ach.id)
  story.achievements = story.achievements.filter((a) => a.id !== ach.id)
  story.achievements.push(ach)
  await projects.saveStory(story)
  const problems = validate(story)
  return {
    ok: true,
    created: isNew,
    achievementId: ach.id,
    count: story.achievements.length,
    validate: problems,
    validatePass: problems.length === 0,
  }
}

export async function deleteAchievement(args: {
  title: string
  achievementId: string
}): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  story.achievements ??= []
  const before = story.achievements.length
  story.achievements = story.achievements.filter((a) => a.id !== args.achievementId)
  if (story.achievements.length === before) {
    return { ok: true, deleted: false, message: `成就 "${args.achievementId}" 不存在` }
  }
  await projects.saveStory(story)
  return { ok: true, deleted: true, achievementId: args.achievementId }
}

export interface UpsertDocumentArgs {
  title: string
  document: StoryDocument
}

export async function upsertDocument(args: UpsertDocumentArgs): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  const doc = args.document
  if (!doc?.id) throw new Error('document.id 不能为空')
  story.documents ??= {}
  const isNew = !story.documents[doc.id]
  story.documents[doc.id] = doc
  await projects.saveStory(story)
  const problems = validate(story)
  return {
    ok: true,
    created: isNew,
    documentId: doc.id,
    count: Object.keys(story.documents).length,
    validate: problems,
    validatePass: problems.length === 0,
  }
}

export async function deleteDocument(args: {
  title: string
  documentId: string
}): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  story.documents ??= {}
  if (!story.documents[args.documentId]) {
    return { ok: true, deleted: false, message: `文档 "${args.documentId}" 不存在` }
  }
  delete story.documents[args.documentId]
  await projects.saveStory(story)
  const problems = validate(story)
  return {
    ok: true,
    deleted: true,
    documentId: args.documentId,
    validate: problems,
    validatePass: problems.length === 0,
  }
}

export async function upsertEvidence(args: { title: string; evidence: Evidence }): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  if (!args.evidence?.id) throw new Error('evidence.id 不能为空')
  story.evidence ??= {}
  const created = !story.evidence[args.evidence.id]
  story.evidence[args.evidence.id] = args.evidence
  await projects.saveStory(story)
  const problems = validate(story)
  return {
    ok: true, created, evidenceId: args.evidence.id,
    count: Object.keys(story.evidence).length,
    validate: problems, validatePass: problems.length === 0,
  }
}

export async function deleteEvidence(args: { title: string; evidenceId: string }): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  story.evidence ??= {}
  if (!story.evidence[args.evidenceId]) return { ok: true, deleted: false }
  delete story.evidence[args.evidenceId]
  await projects.saveStory(story)
  const problems = validate(story)
  return { ok: true, deleted: true, evidenceId: args.evidenceId, validate: problems, validatePass: problems.length === 0 }
}

export async function upsertDeduction(args: { title: string; deduction: Deduction }): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  if (!args.deduction?.id) throw new Error('deduction.id 不能为空')
  story.deductions ??= {}
  const created = !story.deductions[args.deduction.id]
  story.deductions[args.deduction.id] = args.deduction
  await projects.saveStory(story)
  const problems = validate(story)
  return {
    ok: true, created, deductionId: args.deduction.id,
    count: Object.keys(story.deductions).length,
    validate: problems, validatePass: problems.length === 0,
  }
}

export async function deleteDeduction(args: { title: string; deductionId: string }): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  story.deductions ??= {}
  if (!story.deductions[args.deductionId]) return { ok: true, deleted: false }
  delete story.deductions[args.deductionId]
  await projects.saveStory(story)
  return { ok: true, deleted: true, deductionId: args.deductionId }
}

export async function upsertPuzzle(args: { title: string; puzzle: Puzzle }): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  if (!args.puzzle?.id) throw new Error('puzzle.id 不能为空')
  story.puzzles ??= {}
  const created = !story.puzzles[args.puzzle.id]
  story.puzzles[args.puzzle.id] = args.puzzle
  await projects.saveStory(story)
  const problems = validate(story)
  return {
    ok: true, created, puzzleId: args.puzzle.id,
    count: Object.keys(story.puzzles).length,
    validate: problems, validatePass: problems.length === 0,
  }
}

export async function deletePuzzle(args: { title: string; puzzleId: string }): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  story.puzzles ??= {}
  if (!story.puzzles[args.puzzleId]) return { ok: true, deleted: false }
  delete story.puzzles[args.puzzleId]
  await projects.saveStory(story)
  const problems = validate(story)
  return { ok: true, deleted: true, puzzleId: args.puzzleId, validate: problems, validatePass: problems.length === 0 }
}

export const EVIDENCE_TOOLS: ToolDef[] = [
  {
    name: 'story_upsert_achievement',
    description: '创建或覆盖一个成就定义（按 achievement.id）。achievement: {id, title, description, icon?, hidden?, when}，when 支持 #steps/#ending/#visited 特殊变量。',
    schema: { title: z.string(), achievement: AchievementSchema },
    handler: (args) => upsertAchievement(args),
  },
  {
    name: 'story_delete_achievement',
    description: '删除一个成就定义。',
    schema: { title: z.string(), achievementId: z.string() },
    handler: (args) => deleteAchievement(args),
  },
  {
    name: 'story_upsert_document',
    description: '创建或覆盖一个线索/文档定义（按 document.id）。document: {id, title, text, kind?: rules|note|letter|doc}，节点用 effects.gainDocs 收集，玩家可在线索夹查看。',
    schema: { title: z.string(), document: StoryDocumentSchema },
    handler: (args) => upsertDocument(args),
  },
  {
    name: 'story_delete_document',
    description: '删除一个线索/文档定义。',
    schema: { title: z.string(), documentId: z.string() },
    handler: (args) => deleteDocument(args),
  },
  {
    name: 'story_upsert_evidence',
    description: '创建或覆盖一条证据定义。节点用 effects.gainEvidence 获得证据，玩家可在线索板组合证据。',
    schema: { title: z.string(), evidence: EvidenceSchema },
    handler: (args) => upsertEvidence(args),
  },
  {
    name: 'story_delete_evidence',
    description: '删除一条证据定义；删除后请根据校验结果清理引用。',
    schema: { title: z.string(), evidenceId: z.string() },
    handler: (args) => deleteEvidence(args),
  },
  {
    name: 'story_upsert_deduction',
    description: '创建或覆盖一个推论定义。requires.all 要求全部证据，requires.anyOf 的每组要求至少一条；hint 用于证据不足时提供非剧透调查方向。',
    schema: { title: z.string(), deduction: DeductionSchema },
    handler: (args) => upsertDeduction(args),
  },
  {
    name: 'story_delete_deduction',
    description: '删除一个推论定义。',
    schema: { title: z.string(), deductionId: z.string() },
    handler: (args) => deleteDeduction(args),
  },
  {
    name: 'story_upsert_puzzle',
    description: '创建或覆盖一个密码谜题，包含 actionLabel（场景行动文案）、答案、渐进提示、前置条件与成功效果；创建后还要在相关节点的 puzzles 中放置该谜题。',
    schema: { title: z.string(), puzzle: PuzzleSchema },
    handler: (args) => upsertPuzzle(args),
  },
  {
    name: 'story_delete_puzzle',
    description: '删除一个谜题；删除后请根据校验结果清理 #puzzle 条件引用。',
    schema: { title: z.string(), puzzleId: z.string() },
    handler: (args) => deletePuzzle(args),
  },
]