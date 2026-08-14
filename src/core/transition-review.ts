import type { Choice, Story, StoryNode } from './types.js'

export type TransitionRisk =
  | 'missing_target'
  | 'self_loop_without_response'
  | 'converging_choices_without_response'

export interface TransitionReviewItem {
  sourceNodeId: string
  sourceTail: string
  choiceIndex: number
  label: string
  response?: string
  targetNodeId: string
  targetOpening: string
  risks: TransitionRisk[]
}

export interface TransitionReviewOptions {
  nodeIds?: string[]
  onlyRisks?: boolean
  cursor?: number
  limit?: number
}

export interface TransitionReview {
  summary: {
    totalEdges: number
    candidateEdges: number
    returned: number
    responseEdges: number
    riskyEdges: number
  }
  cursor: number
  nextCursor: number | null
  items: TransitionReviewItem[]
}

/**
 * 返回紧凑的“源节点末段 → 选项 → 承接 → 目标首段”审查包。
 * 它只做确定性的结构标记；语气、因果和人物连续性仍由作者/Agent 阅读判断。
 */
export function reviewTransitions(story: Story, options: TransitionReviewOptions = {}): TransitionReview {
  const selected = options.nodeIds ? new Set(options.nodeIds) : null
  const edges = Object.values(story.nodes).flatMap((node) =>
    selected && !selected.has(node.id)
      ? []
      : node.choices.map((choice, choiceIndex) => makeReviewItem(story, node, choice, choiceIndex)))
  const candidates = options.onlyRisks ? edges.filter((item) => item.risks.length > 0) : edges
  const cursor = clampInteger(options.cursor ?? 0, 0, candidates.length)
  const limit = clampInteger(options.limit ?? 20, 1, 50)
  const items = candidates.slice(cursor, cursor + limit)
  const next = cursor + items.length
  return {
    summary: {
      totalEdges: edges.length,
      candidateEdges: candidates.length,
      returned: items.length,
      responseEdges: edges.filter((item) => item.response !== undefined).length,
      riskyEdges: edges.filter((item) => item.risks.length > 0).length,
    },
    cursor,
    nextCursor: next < candidates.length ? next : null,
    items,
  }
}

function makeReviewItem(
  story: Story,
  source: StoryNode,
  choice: Choice,
  choiceIndex: number,
): TransitionReviewItem {
  const sameTarget = source.choices.filter((item) => item.target === choice.target)
  const risks: TransitionRisk[] = []
  if (!story.nodes[choice.target]) risks.push('missing_target')
  if (choice.target === source.id && !choice.response?.trim()) risks.push('self_loop_without_response')
  if (sameTarget.length > 1 && !choice.response?.trim()) risks.push('converging_choices_without_response')
  return {
    sourceNodeId: source.id,
    sourceTail: tail(nodeText(source), 160),
    choiceIndex,
    label: choice.label,
    ...(choice.response?.trim() ? { response: compact(choice.response) } : {}),
    targetNodeId: choice.target,
    targetOpening: head(story.nodes[choice.target] ? nodeText(story.nodes[choice.target]) : '', 200),
    risks,
  }
}

function nodeText(node: StoryNode): string {
  if (node.blocks?.length) {
    return node.blocks.map((block) => [block.title, block.text].filter(Boolean).join('：')).join('\n')
  }
  return node.text
}

function compact(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function head(text: string, length: number): string {
  return compact(text).slice(0, length)
}

function tail(text: string, length: number): string {
  return compact(text).slice(-length)
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.trunc(value)))
}
