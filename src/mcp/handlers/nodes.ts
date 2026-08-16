import path from 'node:path'
import { z } from 'zod'
import { validate } from '../../core/validate.js'
import { ChoicePatchSchema, StrictStoryNodeSchema, type ChoicePatch } from '../../core/schema.js'
import { reviewTransitions, type TransitionReviewOptions } from '../../core/transition-review.js'
import type { StoryNode } from '../../core/types.js'
import * as projects from '../projects.js'
import { ProjectError } from '../projects.js'
import type { ToolDef } from '../tool-def.js'

/**
 * 节点 / 项目结构域：建项目、节点读写删、转场审查、选项补丁、结局删除。
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

export const NODE_TOOLS: ToolDef[] = [
  {
    name: 'story_new',
    description: '创建新的文字冒险游戏项目（写 projects/<标题>/story.json 骨架）。标题已存在时返回现有项目。',
    schema: { title: z.string(), subtitle: z.string().optional(), author: z.string().optional() },
    handler: (args) => newProject(args),
  },
  {
    name: 'story_get',
    description: '读取整个剧情的完整 JSON（含所有节点/选项/结局/条件/效果）。',
    schema: { title: z.string() },
    handler: (args) => getStory(args.title),
  },
  {
    name: 'story_upsert_node',
    description: '创建或覆盖一个节点（按 node.id）。node 为完整节点对象：{id, objective?: 当前目标, text, blocks?, sfx?, soundscape?, stage?, page?, choices[], puzzles?: 谜题id[], ending?, onEnter?, tags?, note?}。choice 可带短 response，点击后显示在目标正文前，适合不同选项汇入同一节点时承接玩家行动；在拟态网站列表页还可带 card:{slot?,summary?,media?,badge?} 渲染成新闻卡片/帖子行/邮件行，纯表现不产生第二路由。text 始终必填，即使提供 blocks；节点进入效果只能写 onEnter，节点顶层没有 effects。soundscape 是受控持续声景对象或 silence，只在声音变化处声明。stage 仅用于特殊剧情/过场，是受控舞台差异 cue 或 clear；非结局节点使用 stage 应打 tags:["cutscene"] 或 ["setpiece"]，否则校验会提示。page 为拟态网站页面语义 {layout?,composition?,section?,headline?,byline?,timestamp?}，composition 只对列表页（frontpage/board/index/inbox）生效；网站导航仍用 choices。未知字段会被拒绝。调查中心、谜题现场和结案阶段应写清 objective；新谜题应通过 puzzles 放进具体场景，成为正文下方的主要行动。写入后自动返回校验结果。',
    schema: { title: z.string(), node: StrictStoryNodeSchema },
    handler: (args) => upsertNode(args),
  },
  {
    name: 'story_delete_node',
    description: '删除节点。若仍有其他选项指向它且未传 force，将报错列出引用处；force:true 会强行删除（可能产生断链）。',
    schema: { title: z.string(), nodeId: z.string(), force: z.boolean().optional() },
    handler: (args) => deleteNode(args),
  },
  {
    name: 'story_delete_ending',
    description: '从结局表删除一个结局（若有节点仍使用它则报错）。创建项目时自带的示例结局可用此工具清理。',
    schema: { title: z.string(), endingId: z.string() },
    handler: (args) => deleteEnding(args),
  },
  {
    name: 'story_get_node',
    description: '读取单个完整节点及所有指向它的入边。局部审查或修稿优先使用本工具，避免 story_get 返回整部作品。',
    schema: { title: z.string(), nodeId: z.string() },
    handler: (args) => getNode(args),
  },
  {
    name: 'story_review_transitions',
    description: '分页返回紧凑的“源节点末段 → 选项 → response → 目标节点首段”审查包，用于检查选择关联、人物位置、因果与语气连续性。默认每页 20 条；先用 onlyRisks:true 处理缺承接及 response 重复目标开头，再分页人工连读其余边。',
    schema: {
      title: z.string(),
      nodeIds: z.array(z.string()).max(50).optional(),
      onlyRisks: z.boolean().optional(),
      cursor: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    handler: (args) => reviewProjectTransitions(args),
  },
  {
    name: 'story_patch_choice',
    description: '只修改一个选项，不覆盖整个节点。先从 story_get_node 或 story_review_transitions 取得 choiceIndex，并传 expectedLabel/expectedTarget 防止并行或过期索引误改；patch 可设置 label/response/target/when/effects，response/when/effects 传 null 表示删除。',
    schema: {
      title: z.string(),
      nodeId: z.string(),
      choiceIndex: z.number().int().nonnegative(),
      expectedLabel: z.string().optional(),
      expectedTarget: z.string().optional(),
      patch: ChoicePatchSchema,
    },
    handler: (args) => patchChoice(args),
  },
]