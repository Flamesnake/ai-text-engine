import type { Story, Vars } from './types.js'
import { applyEffects } from './effects.js'
import { evalCondition } from './conditions.js'

/** 单个结局的模拟统计 */
export interface EndingReach {
  endingId: string
  /** 到达该结局的不同路径数（近似：按访问顺序去重） */
  paths: number
  /** 最短步数（从起始节点起） */
  minSteps: number
}

export interface WalkResult {
  endings: EndingReach[]
  /** 登记但未能到达的结局 */
  unreachableEndings: string[]
  maxDepth: number
  nodesVisited: number
  warnings: string[]
}

export interface WalkOptions {
  /** 单节点最大模拟访问次数（防条件环爆炸），默认 12 */
  maxNodeVisits?: number
  /** 最大模拟深度，默认 200 */
  maxDepth?: number
}

interface SimState {
  vars: Vars
  inventory: string[]
  docs: string[]
  violations: string[]
  day: number
}

/**
 * 全路径模拟：从起始节点深度优先遍历所有可见选项，
 * 统计每个结局的到达路径数与最短步数，帮助 AI 判断分支覆盖是否完整。
 */
export function walkAllEndings(story: Story, options?: WalkOptions): WalkResult {
  const maxNodeVisits = options?.maxNodeVisits ?? 12
  const maxDepth = options?.maxDepth ?? 200

  const counts: Record<string, number> = {}
  const minSteps: Record<string, number> = {}
  const warnings: string[] = []
  let nodesVisited = 0
  let deepest = 0
  const visits: Record<string, number> = {}

  const initial: SimState = { vars: {}, inventory: [], docs: [], violations: [], day: 1 }

  dfs(story, story.start, initial, 1, visits)

  function dfs(
    st: Story,
    nodeId: string,
    state: SimState,
    depth: number,
    vis: Record<string, number>,
  ): void {
    nodesVisited++
    deepest = Math.max(deepest, depth)

    vis[nodeId] = (vis[nodeId] ?? 0) + 1
    if (vis[nodeId] > maxNodeVisits) {
      warnings.push(`节点 "${nodeId}" 被访问超过 ${maxNodeVisits} 次，疑似条件循环，已剪枝`)
      return
    }
    if (depth > maxDepth) {
      warnings.push(`模拟深度超过 ${maxDepth}，已截断`)
      return
    }

    const node = st.nodes[nodeId]
    if (!node) return

    // 进入节点：应用 onEnter
    const s = cloneState(state)
    applyEffects(node.onEnter, s)

    if (node.choices.length === 0) {
      if (node.ending) {
        counts[node.ending.id] = (counts[node.ending.id] ?? 0) + 1
        if (minSteps[node.ending.id] === undefined) minSteps[node.ending.id] = depth
      }
      return
    }

    const visible = node.choices.filter((c) => evalCondition(c.when, s))
    for (const choice of visible) {
      const s2 = cloneState(s)
      applyEffects(choice.effects, s2)
      dfs(st, choice.target, s2, depth + 1, vis)
    }
  }

  const endings: EndingReach[] = Object.keys(counts)
    .map((endingId) => ({
      endingId,
      paths: counts[endingId],
      minSteps: minSteps[endingId] ?? 0,
    }))
    .sort((a, b) => a.endingId.localeCompare(b.endingId))

  const unreachableEndings = Object.keys(story.endings).filter(
    (id) => counts[id] === undefined,
  )

  return { endings, unreachableEndings, maxDepth: deepest, nodesVisited, warnings }
}

function cloneState(s: SimState): SimState {
  return {
    vars: { ...s.vars },
    inventory: [...s.inventory],
    docs: [...s.docs],
    violations: [...s.violations],
    day: s.day,
  }
}
