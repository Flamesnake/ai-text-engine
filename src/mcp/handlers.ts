import type {
  Achievement, Character, Deduction, Evidence, HudStat, StoryDocument, StoryNode, ThemeConfig,
} from '../core/types.js'
import { validate } from '../core/validate.js'
import { walkAllEndings } from '../core/walk.js'
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
  const node = args.node
  if (!node?.id) throw new Error('node.id 不能为空')
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

export async function validateStory(title: string): Promise<unknown> {
  const story = await projects.loadStory(title)
  const problems = validate(story)
  const walk = walkAllEndings(story)
  return {
    ok: true,
    title,
    validatePass: problems.length === 0,
    problems,
    nodeCount: Object.keys(story.nodes).length,
    endingCount: Object.keys(story.endings).length,
    walk,
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
}): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  if (args.subtitle !== undefined) story.meta.subtitle = args.subtitle
  if (args.author !== undefined) story.meta.author = args.author
  if (args.theme !== undefined) story.meta.theme = args.theme
  if (args.hud !== undefined) story.meta.hud = args.hud
  await projects.saveStory(story)
  return { ok: true, meta: story.meta }
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
  story_validate: (args: { title: string }) => validateStory(args.title),
  story_walk: (args: { title: string }) => validateStory(args.title),
  story_graph: (args: { title: string }) => graph(args.title),
  story_export: (args: ExportArgs) => exportStory(args),
  story_set_meta: (args: { title: string; subtitle?: string; author?: string }) => setMeta(args),
  story_list: () => listProjects(),
  story_delete_project: (args: { title: string }) => deleteProject(args.title),
}
