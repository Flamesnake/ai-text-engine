import type { Story, Vars } from './types.js'
import { applyEffects } from './effects.js'
import { evalCondition, type ConditionContext } from './conditions.js'

/** 单个结局的模拟统计 */
export interface EndingReach {
  endingId: string
  /** 到达该结局的不同路径数（近似：按访问顺序去重；随机分支按注入随机源各取一值） */
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
  /** 单条路径上单节点最大访问次数（防条件环爆炸），默认 12 */
  maxNodeVisits?: number
  /** 最大模拟深度，默认 200 */
  maxDepth?: number
  /** 随机源（用于 rand 效果）。默认固定 0.5（取中间值），保证结果可复现 */
  rand?: () => number
  /** 单个场景最多探索的推论组合状态，默认 64；超过时截断并警告 */
  maxDeductionVariants?: number
}

interface SimState {
  vars: Vars
  inventory: string[]
  docs: string[]
  evidence: string[]
  deductions: string[]
  relations: Record<string, Record<string, number>>
  memories: string[]
  revealedSecrets: string[]
  solvedPuzzles: string[]
  violations: string[]
  day: number
  /** 去重后的已访问节点（与 GameState.visited 语义一致，供 #visited 条件） */
  visited: string[]
}

/**
 * 受限、近似路径探索（原「全路径模拟」）：从起始节点深度优先遍历各分支，
 * 统计每个结局的路径数与最短步数。
 *
 * 语义约定：
 * - 每条路径独立维护节点访问计数，互不影响（分支汇合节点不会被其他路径误判为循环）；
 * - 随机效果（rand）按注入的随机源取确定值（默认中间值），因此单次遍历
 *   不能证明所有随机结果下结局都可达——若需覆盖，可多次以不同 rand 调用；
 * - 条件求值使用与 Game 相同的完整上下文（含 #day/#docs/#violated/#steps/#visited）。
 */
export function walkAllEndings(story: Story, options?: WalkOptions): WalkResult {
  const maxNodeVisits = options?.maxNodeVisits ?? 12
  const maxDepth = options?.maxDepth ?? 200
  const rand = options?.rand ?? (() => 0.5)
  const maxDeductionVariants = options?.maxDeductionVariants ?? 64

  const counts: Record<string, number> = {}
  const minSteps: Record<string, number> = {}
  const warnings: string[] = []
  const warned = new Set<string>()
  const warn = (msg: string): void => {
    if (!warned.has(msg)) {
      warned.add(msg)
      warnings.push(msg)
    }
  }
  let nodesVisited = 0
  let deepest = 0

  const initialRelations = Object.fromEntries(
    Object.entries(story.characters ?? {}).map(([characterId, character]) => [
      characterId,
      Object.fromEntries(Object.entries(character.relations ?? {}).map(([stat, def]) => [stat, def.initial ?? 0])),
    ]),
  )
  const relationLimits = Object.fromEntries(
    Object.entries(story.characters ?? {}).map(([characterId, character]) => [characterId, character.relations ?? {}]),
  )
  const initial: SimState = {
    vars: {}, inventory: [], docs: [], evidence: [], deductions: [],
    relations: initialRelations, memories: [], revealedSecrets: [],
    solvedPuzzles: [],
    violations: [], day: 1, visited: [],
  }

  dfs(story, story.start, initial, 1, {})

  function dfs(
    st: Story,
    nodeId: string,
    state: SimState,
    depth: number,
    // 本条路径上的节点访问计数（进入分支时已复制，各路径独立）
    vis: Record<string, number>,
  ): void {
    nodesVisited++
    deepest = Math.max(deepest, depth)

    if (depth > maxDepth) {
      warn(`模拟深度超过 ${maxDepth}，已截断`)
      return
    }

    const node = st.nodes[nodeId]
    if (!node) return

    // 进入节点：按路径累计访问计数（复制快照，不影响兄弟分支）
    const nextVis = { ...vis }
    const count = (nextVis[nodeId] ?? 0) + 1
    nextVis[nodeId] = count
    if (count > maxNodeVisits) {
      warn(`节点 "${nodeId}" 在本路径被访问超过 ${maxNodeVisits} 次，疑似条件循环，已剪枝`)
      return
    }

    // 应用 onEnter
    const s = cloneState(state)
    if (!s.visited.includes(nodeId)) s.visited.push(nodeId)
    applySimEffects(node.onEnter, s)

    if (node.choices.length === 0) {
      if (node.ending) {
        counts[node.ending.id] = (counts[node.ending.id] ?? 0) + 1
        // 记录最小步数（DFS 首达的不一定是最短路径）
        if (minSteps[node.ending.id] === undefined || depth < minSteps[node.ending.id]) {
          minSteps[node.ending.id] = depth
        }
      }
      return
    }

    // 线索板是场景外动作：同时探索“不确认”和所有当前可确认的推论组合。
    // 这样推论解锁的选项不会被误报不可达，同时保留玩家暂不推理的路径。
    for (const deductionState of deductionVariants(st, s)) {
      for (const puzzleState of puzzleVariants(st, deductionState, depth)) {
      const ctx: ConditionContext = {
        vars: puzzleState.vars,
        inventory: puzzleState.inventory,
        steps: depth,
        endingId: null,
        visited: puzzleState.visited,
        docs: puzzleState.docs,
        day: puzzleState.day,
        violations: puzzleState.violations,
        evidence: puzzleState.evidence,
        deductions: puzzleState.deductions,
        relations: puzzleState.relations,
        memories: puzzleState.memories,
        revealedSecrets: puzzleState.revealedSecrets,
        solvedPuzzles: puzzleState.solvedPuzzles,
      }
      const visible = node.choices.filter((c) => evalCondition(c.when, ctx))
      for (const choice of visible) {
        const s2 = cloneState(puzzleState)
        applySimEffects(choice.effects, s2)
        dfs(st, choice.target, s2, depth + 1, nextVis)
      }
      }
    }
  }

  /** 枚举当前可解决谜题的状态组合（含暂不解谜）。 */
  function puzzleVariants(st: Story, initialState: SimState, depth: number): SimState[] {
    const variants: SimState[] = [cloneState(initialState)]
    const seen = new Set<string>([''])
    for (let index = 0; index < variants.length; index++) {
      const current = variants[index]
      const ctx: ConditionContext = {
        vars: current.vars, inventory: current.inventory, steps: depth, endingId: null,
        visited: current.visited, docs: current.docs, day: current.day,
        violations: current.violations, evidence: current.evidence, deductions: current.deductions,
        relations: current.relations, memories: current.memories,
        revealedSecrets: current.revealedSecrets, solvedPuzzles: current.solvedPuzzles,
      }
      for (const puzzle of Object.values(st.puzzles ?? {})) {
        if (current.solvedPuzzles.includes(puzzle.id) || !evalCondition(puzzle.requires, ctx)) continue
        const next = cloneState(current)
        next.solvedPuzzles.push(puzzle.id)
        applySimEffects(puzzle.onSolved, next)
        const key = [...next.solvedPuzzles].sort().join('\u0000')
        if (!seen.has(key)) {
          seen.add(key)
          variants.push(next)
        }
      }
    }
    return variants
  }

  /** 枚举玩家在当前证据下可以选择确认的推论状态（含一个都不确认）。 */
  function deductionVariants(st: Story, initialState: SimState): SimState[] {
    const variants: SimState[] = [cloneState(initialState)]
    const seen = new Set<string>([''])
    for (let index = 0; index < variants.length; index++) {
      const current = variants[index]
      for (const deduction of Object.values(st.deductions ?? {})) {
        if (current.deductions.includes(deduction.id)) continue
        const owned = new Set(current.evidence)
        const canConfirm =
          (deduction.requires.all ?? []).every((id) => owned.has(id)) &&
          (deduction.requires.anyOf ?? []).every((group) => group.some((id) => owned.has(id)))
        if (!canConfirm) continue
        const next = cloneState(current)
        next.deductions.push(deduction.id)
        applySimEffects(deduction.onConfirmed, next)
        const key = [...next.deductions].sort().join('\u0000')
        if (!seen.has(key)) {
          if (variants.length >= maxDeductionVariants) {
            warn(`节点推论组合超过 ${maxDeductionVariants} 种，已截断探索`)
            return variants
          }
          seen.add(key)
          variants.push(next)
        }
      }
    }
    return variants
  }

  /** 注入关系上下限，并把 EffectTarget 的标量 day 回写到模拟状态。 */
  function applySimEffects(effects: Parameters<typeof applyEffects>[0], state: SimState): void {
    const target = { ...state, relationLimits }
    applyEffects(effects, target, rand)
    state.day = target.day
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
    evidence: [...s.evidence],
    deductions: [...s.deductions],
    relations: structuredClone(s.relations),
    memories: [...s.memories],
    revealedSecrets: [...s.revealedSecrets],
    solvedPuzzles: [...s.solvedPuzzles],
    violations: [...s.violations],
    day: s.day,
    visited: [...s.visited],
  }
}
