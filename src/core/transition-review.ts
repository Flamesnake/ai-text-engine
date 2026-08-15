import type { Choice, Story, StoryNode } from './types.js'

export type TransitionRisk =
  | 'missing_target'
  | 'self_loop_without_response'
  | 'converging_choices_without_response'
  | 'response_repeats_target_opening'

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
  if (choice.response && story.nodes[choice.target] && responseRepeatsTargetOpening(
    choice.response,
    nodeText(story.nodes[choice.target]),
  )) risks.push('response_repeats_target_opening')
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

/**
 * 标记短 response 与目标第一句的完整重复或高重合候选。
 * 不尝试理解同义句或判断文学质量；结果只用于缩小人工连读范围。
 */
export function responseRepeatsTargetOpening(response: string, targetText: string): boolean {
  const normalizedResponse = normalizeForComparison(firstSentence(response))
  const normalizedTarget = normalizeForComparison(firstSentence(targetText))
  if (normalizedResponse.length < 6 || normalizedTarget.length < 6) return false
  if (normalizedTarget.startsWith(normalizedResponse)) return true
  const overlap = longestCommonSubstringLength(normalizedResponse, normalizedTarget)
  if (overlap >= 6 && overlap / Math.min(normalizedResponse.length, normalizedTarget.length) >= 0.5) return true
  return bigramDice(normalizedResponse, normalizedTarget) >= 0.68
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

function normalizeForComparison(text: string): string {
  return text.normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '').toLocaleLowerCase()
}

function firstSentence(text: string): string {
  return text.split(/[。！？!?\n]/, 1)[0] ?? text
}

function longestCommonSubstringLength(left: string, right: string): number {
  let previous = new Array<number>(right.length + 1).fill(0)
  let longest = 0
  for (let i = 1; i <= left.length; i++) {
    const current = new Array<number>(right.length + 1).fill(0)
    for (let j = 1; j <= right.length; j++) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = previous[j - 1] + 1
        longest = Math.max(longest, current[j])
      }
    }
    previous = current
  }
  return longest
}

function bigramDice(left: string, right: string): number {
  const leftBigrams = new Set(Array.from({ length: left.length - 1 }, (_, i) => left.slice(i, i + 2)))
  const rightBigrams = new Set(Array.from({ length: right.length - 1 }, (_, i) => right.slice(i, i + 2)))
  const overlap = [...leftBigrams].filter((item) => rightBigrams.has(item)).length
  return (2 * overlap) / Math.max(1, leftBigrams.size + rightBigrams.size)
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
