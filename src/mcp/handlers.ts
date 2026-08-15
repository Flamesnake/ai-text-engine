import type {
  Achievement, Character, Deduction, Evidence, HudStat, PresentationConfig, Puzzle, SiteConfig, SoundscapeSpec, StateAxisConfig, StoryDocument, StoryNode, ThemeConfig,
} from '../core/types.js'
import { validate, validateExperience } from '../core/validate.js'
import { evaluateStory } from '../core/evaluate.js'
import { ChoicePatchSchema, StrictStoryNodeSchema, type ChoicePatch } from '../core/schema.js'
import { reviewTransitions, type TransitionReviewOptions } from '../core/transition-review.js'
import { walkAllEndings, type WalkOptions, type WalkResult } from '../core/walk.js'
import { exportToHtml } from '../export/exporter.js'
import path from 'node:path'
import * as projects from './projects.js'
import { ProjectError } from './projects.js'

/**
 * MCP 工具实现（与 transport 解耦，可直接单测）。
 * 所有 handler 接收纯参数、返回可 JSON 序列化的结果；出错抛 Error。
 */

export interface NewProjectArgs {
  title: string
  subtitle?: string
  author?: string
}

export async function newProject(args: NewProjectArgs): Promise<unknown> {
  if (!args.title?.trim()) throw new Error('title 不能为空')
  // 仅「不存在」视为可新建；数据损坏等错误原样抛出，不再伪装成不存在
  const existing = await projects.loadStory(args.title).catch((err: unknown) => {
    if (err instanceof ProjectError && err.code === 'NOT_FOUND') return null
    throw err
  })
  if (existing) {
    return {
      ok: true,
      existed: true,
      message: `项目 "${args.title}" 已存在，直接复用现有剧情`,
      nodeCount: Object.keys(existing.nodes).length,
    }
  }
  const story = projects.createSkeletonStory({
    title: args.title.trim(),
    subtitle: args.subtitle,
    author: args.author,
  })
  const dir = await projects.saveStory(story)
  return {
    ok: true,
    existed: false,
    message: `已创建项目 "${story.meta.title}"`,
    path: path.join(dir, 'story.json'),
    nodeCount: Object.keys(story.nodes).length,
  }
}

export async function getStory(title: string): Promise<unknown> {
  const story = await projects.loadStory(title)
  return { title, story }
}

export interface UpsertNodeArgs {
  title: string
  node: StoryNode
}

export async function upsertNode(args: UpsertNodeArgs): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  // handler 也是脚本/测试可直接调用的公共边界，不能只依赖 MCP transport 校验。
  // strict 解析会在落盘前拒绝缺字段和未知字段，避免本次写入成功、下次读取 CORRUPT。
  const node = StrictStoryNodeSchema.parse(args.node)
  const isNew = !story.nodes[node.id]
  // 若节点曾带 ending 而新版本不带，且无其他节点使用该结局，则从结局表清理
  const prev = story.nodes[node.id]
  if (prev?.ending && !node.ending && story.endings[prev.ending.id]) {
    const stillUsed = Object.values(story.nodes).some(
      (n) => n.id !== node.id && n.ending?.id === prev.ending!.id,
    )
    if (!stillUsed) delete story.endings[prev.ending.id]
  }
  story.nodes[node.id] = node
  // 结局自动登记到结局表（新增或更新）
  if (node.ending) {
    story.endings[node.ending.id] = node.ending
  }
  await projects.saveStory(story)
  const problems = validate(story)
  return {
    ok: true,
    created: isNew,
    nodeId: node.id,
    nodeCount: Object.keys(story.nodes).length,
    validate: problems,
    validatePass: problems.length === 0,
    hint: problems.length > 0 ? '剧情校验未通过，见 validate 列表' : undefined,
  }
}

export interface DeleteNodeArgs {
  title: string
  nodeId: string
  force?: boolean
}

export async function deleteNode(args: DeleteNodeArgs): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  if (!story.nodes[args.nodeId]) {
    return { ok: true, deleted: false, message: `节点 "${args.nodeId}" 不存在` }
  }
  // 找出引用该节点的选项
  const refs: string[] = []
  for (const n of Object.values(story.nodes)) {
    for (const c of n.choices) {
      if (c.target === args.nodeId) refs.push(`${n.id} →「${c.label}」`)
    }
  }
  if (refs.length > 0 && !args.force) {
    throw new Error(
      `节点 "${args.nodeId}" 仍被 ${refs.length} 处引用：${refs.join('、')}。` +
        `如确认要删，请带 force: true（将产生断链，需用 story_validate 复核）`,
    )
  }
  delete story.nodes[args.nodeId]
  await projects.saveStory(story)
  const problems = validate(story)
  return {
    ok: true,
    deleted: true,
    nodeId: args.nodeId,
    brokenRefs: refs.length,
    validate: problems,
    validatePass: problems.length === 0,
  }
}

export async function deleteEnding(args: { title: string; endingId: string }): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  if (!story.endings[args.endingId]) {
    return { ok: true, deleted: false, message: `结局 "${args.endingId}" 不存在` }
  }
  // 若有节点仍使用该结局，需先处理节点
  const users = Object.values(story.nodes)
    .filter((n) => n.ending?.id === args.endingId)
    .map((n) => n.id)
  if (users.length > 0) {
    throw new Error(
      `结局 "${args.endingId}" 仍被节点使用：${users.join('、')}。请先修改这些节点的 ending 或删除节点`,
    )
  }
  delete story.endings[args.endingId]
  await projects.saveStory(story)
  const problems = validate(story)
  return {
    ok: true,
    deleted: true,
    endingId: args.endingId,
    validate: problems,
    validatePass: problems.length === 0,
  }
}

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

/** 只读取一个节点及其入边，避免为了局部修稿拉取整部 story。 */
export async function getNode(args: { title: string; nodeId: string }): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  const node = story.nodes[args.nodeId]
  if (!node) throw new ProjectError('NOT_FOUND', `节点 "${args.nodeId}" 不存在`)
  const incoming = Object.values(story.nodes).flatMap((source) => source.choices.flatMap((choice, choiceIndex) =>
    choice.target === args.nodeId
      ? [{ sourceNodeId: source.id, choiceIndex, label: choice.label, response: choice.response }]
      : []))
  return { ok: true, title: args.title, node, incoming }
}

export interface ReviewTransitionsArgs extends TransitionReviewOptions {
  title: string
}

/** 分页返回紧凑转场上下文，供一次集中连贯性修订。 */
export async function reviewProjectTransitions(args: ReviewTransitionsArgs): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  const { title, ...options } = args
  const missingNodeIds = (options.nodeIds ?? []).filter((nodeId) => !story.nodes[nodeId])
  if (missingNodeIds.length > 0) {
    throw new ProjectError('NOT_FOUND', `找不到节点：${missingNodeIds.join('、')}`)
  }
  return { ok: true, title, review: reviewTransitions(story, options) }
}

export interface PatchChoiceArgs {
  title: string
  nodeId: string
  choiceIndex: number
  expectedLabel?: string
  expectedTarget?: string
  patch: ChoicePatch
}

/** 局部修改一个选项；可选旧值断言防止节点变化后按过期索引误改。 */
export async function patchChoice(args: PatchChoiceArgs): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  const node = story.nodes[args.nodeId]
  if (!node) throw new ProjectError('NOT_FOUND', `节点 "${args.nodeId}" 不存在`)
  if (!Number.isInteger(args.choiceIndex) || args.choiceIndex < 0 || args.choiceIndex >= node.choices.length) {
    throw new RangeError(`选项索引越界：${args.choiceIndex}（节点 ${args.nodeId} 有 ${node.choices.length} 个选项）`)
  }
  const previous = node.choices[args.choiceIndex]
  if (args.expectedLabel !== undefined && previous.label !== args.expectedLabel) {
    throw new ProjectError('CONFLICT', `选项 ${args.nodeId}[${args.choiceIndex}] 的 label 已变为「${previous.label}」，拒绝按旧值修改`)
  }
  if (args.expectedTarget !== undefined && previous.target !== args.expectedTarget) {
    throw new ProjectError('CONFLICT', `选项 ${args.nodeId}[${args.choiceIndex}] 的 target 已变为 "${previous.target}"，拒绝按旧值修改`)
  }
  const patch = ChoicePatchSchema.parse(args.patch)
  const next = structuredClone(previous)
  applyOptionalPatch(next, patch, 'label')
  applyOptionalPatch(next, patch, 'target')
  applyNullablePatch(next, patch, 'response')
  applyNullablePatch(next, patch, 'when')
  applyNullablePatch(next, patch, 'effects')
  node.choices[args.choiceIndex] = next
  // 对局部补丁后的完整节点再次执行严格解析，再进入项目级落盘防线。
  story.nodes[args.nodeId] = StrictStoryNodeSchema.parse(node)
  await projects.saveStory(story)
  const problems = validate(story)
  return {
    ok: true,
    nodeId: args.nodeId,
    choiceIndex: args.choiceIndex,
    previous,
    choice: story.nodes[args.nodeId].choices[args.choiceIndex],
    validate: problems,
    validatePass: problems.length === 0,
  }
}

function applyOptionalPatch<K extends 'label' | 'target'>(
  choice: StoryNode['choices'][number],
  patch: ChoicePatch,
  key: K,
): void {
  if (patch[key] !== undefined) choice[key] = patch[key]!
}

function applyNullablePatch<K extends 'response' | 'when' | 'effects'>(
  choice: StoryNode['choices'][number],
  patch: ChoicePatch,
  key: K,
): void {
  if (!Object.prototype.hasOwnProperty.call(patch, key)) return
  const value = patch[key]
  if (value === null || value === undefined) delete choice[key]
  else Object.assign(choice, { [key]: value })
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

function compactWalkResult(walk: WalkResult): Omit<WalkResult, 'reachability' | 'failures'> & {
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

/** 单独的紧凑视觉配置工具，避免为改外观重复发送其他 meta 字段。 */
export async function setPresentation(args: {
  title: string
  presentation: PresentationConfig
}): Promise<unknown> {
  return setMeta({ title: args.title, presentation: args.presentation })
}

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

export async function upsertCharacter(args: { title: string; character: Character }): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  if (!args.character?.id) throw new Error('character.id 不能为空')
  story.characters ??= {}
  const created = !story.characters[args.character.id]
  story.characters[args.character.id] = args.character
  await projects.saveStory(story)
  const problems = validate(story)
  return {
    ok: true, created, characterId: args.character.id,
    count: Object.keys(story.characters).length,
    validate: problems, validatePass: problems.length === 0,
  }
}

export async function deleteCharacter(args: { title: string; characterId: string }): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  story.characters ??= {}
  if (!story.characters[args.characterId]) return { ok: true, deleted: false }
  delete story.characters[args.characterId]
  await projects.saveStory(story)
  const problems = validate(story)
  return { ok: true, deleted: true, characterId: args.characterId, validate: problems, validatePass: problems.length === 0 }
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

/** 供 MCP 服务器注册时使用的工具清单（名称 → 实现） */
export const tools = {
  story_new: newProject,
  story_get: (args: { title: string }) => getStory(args.title),
  story_get_node: (args: { title: string; nodeId: string }) => getNode(args),
  story_review_transitions: (args: ReviewTransitionsArgs) => reviewProjectTransitions(args),
  story_patch_choice: (args: PatchChoiceArgs) => patchChoice(args),
  story_upsert_node: (args: UpsertNodeArgs) => upsertNode(args),
  story_delete_node: (args: DeleteNodeArgs) => deleteNode(args),
  story_delete_ending: (args: { title: string; endingId: string }) => deleteEnding(args),
  story_upsert_achievement: (args: UpsertAchievementArgs) => upsertAchievement(args),
  story_delete_achievement: (args: { title: string; achievementId: string }) =>
    deleteAchievement(args),
  story_upsert_document: (args: UpsertDocumentArgs) => upsertDocument(args),
  story_delete_document: (args: { title: string; documentId: string }) => deleteDocument(args),
  story_upsert_evidence: (args: { title: string; evidence: Evidence }) => upsertEvidence(args),
  story_delete_evidence: (args: { title: string; evidenceId: string }) => deleteEvidence(args),
  story_upsert_deduction: (args: { title: string; deduction: Deduction }) => upsertDeduction(args),
  story_delete_deduction: (args: { title: string; deductionId: string }) => deleteDeduction(args),
  story_upsert_character: (args: { title: string; character: Character }) => upsertCharacter(args),
  story_delete_character: (args: { title: string; characterId: string }) => deleteCharacter(args),
  story_upsert_puzzle: (args: { title: string; puzzle: Puzzle }) => upsertPuzzle(args),
  story_delete_puzzle: (args: { title: string; puzzleId: string }) => deletePuzzle(args),
  story_validate: (args: ValidateStoryArgs) => validateStory(args),
  story_evaluate: (args: EvaluateProjectArgs) => evaluateProject(args),
  story_walk: (args: WalkStoryArgs) => walkStory(args),
  story_graph: (args: { title: string }) => graph(args.title),
  story_export: (args: ExportArgs) => exportStory(args),
  story_set_meta: (args: { title: string; subtitle?: string; author?: string; site?: SiteConfig; soundscape?: SoundscapeSpec; world?: StateAxisConfig; phase?: StateAxisConfig }) => setMeta(args),
  story_set_presentation: (args: { title: string; presentation: PresentationConfig }) => setPresentation(args),
  story_list: () => listProjects(),
  story_delete_project: (args: { title: string }) => deleteProject(args.title),
}
