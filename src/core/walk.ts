import type { DeductionRequirement, Story, Vars } from './types.js'
import { applyEffects } from './effects.js'
import { evalCondition, type ConditionContext } from './conditions.js'

/** 单个结局的模拟统计 */
export interface EndingReach {
  endingId: string
  /** 到达该结局的状态路径数（近似：等价状态合并；随机分支按注入随机源各取一值） */
  paths: number
  /** 最短步数（从起始节点起） */
  minSteps: number
}

export type WalkAction =
  | { type: 'choice'; nodeId: string; label: string; target: string }
  | { type: 'deduction'; nodeId: string; deductionId: string; evidence: string[] }
  | { type: 'puzzle'; nodeId: string; puzzleId: string }

/** 能被 Game / DOM 验收器重放的单条结局见证。 */
export interface EndingWitness {
  endingId: string
  steps: number
  actions: WalkAction[]
  source: 'coverage' | 'targeted'
}

export interface FailureWitness {
  kind: 'invalid_terminal' | 'soft_lock'
  nodeId: string
  steps: number
  actions: WalkAction[]
  /** 软锁节点中存在但在该状态下全部不可见的选项；非法终点为空。 */
  blockedChoices: string[]
}

export interface WalkResult {
  endings: EndingReach[]
  /** 登记但未能到达的结局 */
  unreachableEndings: string[]
  maxDepth: number
  nodesVisited: number
  /** 全局状态预算使用情况；utilization 为 0..1 的比例。 */
  budget: {
    used: number
    limit: number
    utilization: number
  }
  /** 诊断模式下按访问次数降序返回的热点节点。 */
  hotNodes?: Array<{ nodeId: string; visits: number }>
  /** 是否因全局状态预算耗尽而提前停止；为 true 时不可用本结果证明剩余结局不可达。 */
  truncated: boolean
  /** 结局可达证明；与全状态覆盖是否完成相互独立。 */
  reachability: {
    allEndingsProven: boolean
    provenEndings: string[]
    unprovenEndings: string[]
    witnesses: EndingWitness[]
    witnessSearch: { used: number; limitPerEnding: number }
  }
  /** 当前确定随机模型下的全状态覆盖诊断。 */
  coverage: {
    complete: boolean
    reasons: Array<'state_budget' | 'max_depth' | 'node_visit_limit' | 'deduction_variants'>
  }
  /** 已实际找到的失败路径；complete=false 时“未发现”不能解释为“不存在”。 */
  failures: {
    complete: boolean
    witnesses: FailureWitness[]
  }
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
  /** 全局最多访问的搜索状态数，默认 100000；防开放 hub 状态空间拖死校验。 */
  maxStates?: number
  /** 返回热点节点访问统计，供定位开放 hub / 回环 / 推论组合爆炸。 */
  diagnostics?: boolean
  /** 诊断模式最多返回多少个热点节点，默认 10。 */
  topNodes?: number
  /** coverage 截断时，为每个未证明结局追加的目标导向搜索预算，默认 25000。 */
  witnessMaxStates?: number
  /** 内部目标导向搜索使用；MCP 不公开。 */
  targetEndingId?: string
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
  world: string
  phase: string
  /** 去重后的已访问节点（与 GameState.visited 语义一致，供 #visited 条件） */
  visited: string[]
}

interface SimVariant {
  state: SimState
  actions: WalkAction[]
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
  const maxStates = options?.maxStates ?? 100_000
  const diagnostics = options?.diagnostics ?? false
  const topNodes = Math.max(1, Math.floor(options?.topNodes ?? 10))
  const witnessMaxStates = options?.witnessMaxStates ?? 25_000
  const targetEndingId = options?.targetEndingId

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
  const nodeVisits: Record<string, number> = {}
  let deepest = 0
  let truncated = false
  let targetFound = false
  const coverageReasons = new Set<WalkResult['coverage']['reasons'][number]>()
  const witnesses = new Map<string, EndingWitness>()
  const failureWitnesses = new Map<string, FailureWitness>()
  // 同一节点以相同状态再次抵达时只探索最短的首次抵达。
  // 路径数按状态路径近似统计，不枚举调查顺序的排列组合。
  const bestDepthByState = new Map<string, number>()

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
    violations: [], day: 1,
    world: story.meta.world?.initial ?? 'default',
    phase: story.meta.phase?.initial ?? 'default',
    visited: [],
  }
  // visited 只会通过 #visited 条件影响未来行为。状态去重时保留被实际引用的节点，
  // 避免纯参观历史把等价的调查顺序膨胀成 2^n 个状态；求值上下文仍保留完整 visited。
  const relevantVisitedIds = collectRelevantVisitedIds(story)
  const targetDistances = targetEndingId ? distancesToEnding(story, targetEndingId) : undefined

  dfs(story, story.start, initial, 1, {}, [])

  function dfs(
    st: Story,
    nodeId: string,
    state: SimState,
    depth: number,
    // 本条路径上的节点访问计数（进入分支时已复制，各路径独立）
    vis: Record<string, number>,
    path: WalkAction[],
  ): void {
    if (truncated || targetFound) return
    if (nodesVisited >= maxStates) {
      truncated = true
      coverageReasons.add('state_budget')
      warn(
        `路径探索达到全局状态预算 ${maxStates}，已提前停止；` +
        '当前未到达结局不能据此判定为不可达，请收敛循环/开放 hub 后重试',
      )
      return
    }
    nodesVisited++
    nodeVisits[nodeId] = (nodeVisits[nodeId] ?? 0) + 1
    deepest = Math.max(deepest, depth)

    if (depth > maxDepth) {
      coverageReasons.add('max_depth')
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
      coverageReasons.add('node_visit_limit')
      warn(`节点 "${nodeId}" 在本路径被访问超过 ${maxNodeVisits} 次，疑似条件循环，已剪枝`)
      return
    }

    // 应用 onEnter
    const s = cloneState(state)
    if (!s.visited.includes(nodeId)) s.visited.push(nodeId)
    applySimEffects(node.onEnter, s)

    const stateKey = `${nodeId}\u0001${simStateKey(s, relevantVisitedIds)}`
    const bestDepth = bestDepthByState.get(stateKey)
    if (bestDepth !== undefined && bestDepth <= depth) return
    bestDepthByState.set(stateKey, depth)

    if (node.choices.length === 0) {
      if (node.ending) {
        counts[node.ending.id] = (counts[node.ending.id] ?? 0) + 1
        // 记录最小步数（DFS 首达的不一定是最短路径）
        if (minSteps[node.ending.id] === undefined || depth < minSteps[node.ending.id]) {
          minSteps[node.ending.id] = depth
          witnesses.set(node.ending.id, {
            endingId: node.ending.id,
            steps: depth,
            actions: path,
            source: targetEndingId ? 'targeted' : 'coverage',
          })
        }
        if (targetEndingId === node.ending.id) targetFound = true
      } else if (!targetEndingId) {
        recordFailure({
          kind: 'invalid_terminal', nodeId, steps: depth, actions: path, blockedChoices: [],
        })
      }
      return
    }

    // 线索板是场景外动作：同时探索“不确认”和所有当前可确认的推论组合。
    // 这样推论解锁的选项不会被误报不可达，同时保留玩家暂不推理的路径。
    let deductionStates = deductionVariants(st, nodeId, s)
    if (targetEndingId) {
      deductionStates = deductionStates.sort((a, b) => b.state.deductions.length - a.state.deductions.length)
    }
    for (const deductionVariant of deductionStates) {
      let puzzleStates = puzzleVariants(st, nodeId, deductionVariant, depth)
      if (targetEndingId) {
        puzzleStates = puzzleStates.sort((a, b) => b.state.solvedPuzzles.length - a.state.solvedPuzzles.length)
      }
      for (const puzzleVariant of puzzleStates) {
      if (truncated || targetFound) return
      const puzzleState = puzzleVariant.state
      const ctx: ConditionContext = {
        vars: puzzleState.vars,
        inventory: puzzleState.inventory,
        steps: depth,
        endingId: null,
        visited: puzzleState.visited,
        docs: puzzleState.docs,
        day: puzzleState.day,
        world: puzzleState.world,
        phase: puzzleState.phase,
        violations: puzzleState.violations,
        evidence: puzzleState.evidence,
        deductions: puzzleState.deductions,
        relations: puzzleState.relations,
        memories: puzzleState.memories,
        revealedSecrets: puzzleState.revealedSecrets,
        solvedPuzzles: puzzleState.solvedPuzzles,
      }
      let visible = node.choices.filter((c) => evalCondition(c.when, ctx))
      if (targetDistances) {
        visible = [...visible].sort((a, b) =>
          (targetDistances.get(a.target) ?? Number.POSITIVE_INFINITY) -
          (targetDistances.get(b.target) ?? Number.POSITIVE_INFINITY))
      }
      if (
        visible.length === 0 &&
        !targetEndingId &&
        !hasAvailableProgressAction(st, nodeId, puzzleState, depth)
      ) {
        recordFailure({
          kind: 'soft_lock',
          nodeId,
          steps: depth,
          actions: [...path, ...deductionVariant.actions, ...puzzleVariant.actions],
          blockedChoices: node.choices.map((choice) => choice.label),
        })
      }
      for (const choice of visible) {
        const s2 = cloneState(puzzleState)
        applySimEffects(choice.effects, s2)
        dfs(st, choice.target, s2, depth + 1, nextVis, [
          ...path,
          ...deductionVariant.actions,
          ...puzzleVariant.actions,
          { type: 'choice', nodeId, label: choice.label, target: choice.target },
        ])
      }
      }
    }
  }

  function recordFailure(witness: FailureWitness): void {
    const key = `${witness.kind}\u0001${witness.nodeId}`
    const existing = failureWitnesses.get(key)
    if (!existing || witness.steps < existing.steps ||
      (witness.steps === existing.steps && witness.actions.length < existing.actions.length)) {
      failureWitnesses.set(key, witness)
    }
  }

  /** 推理板或谜题仍能改变状态时，零可见选项不是软锁。 */
  function hasAvailableProgressAction(st: Story, nodeId: string, state: SimState, depth: number): boolean {
    const owned = new Set(state.evidence)
    const canConfirmDeduction = Object.values(st.deductions ?? {}).some((deduction) =>
      !state.deductions.includes(deduction.id) &&
      (deduction.requires.all ?? []).every((id) => owned.has(id)) &&
      (deduction.requires.anyOf ?? []).every((group) => group.some((id) => owned.has(id))))
    if (canConfirmDeduction) return true

    const ctx: ConditionContext = {
      vars: state.vars, inventory: state.inventory, steps: depth, endingId: null,
      visited: state.visited, docs: state.docs, day: state.day,
      world: state.world, phase: state.phase, violations: state.violations,
      evidence: state.evidence, deductions: state.deductions, relations: state.relations,
      memories: state.memories, revealedSecrets: state.revealedSecrets,
      solvedPuzzles: state.solvedPuzzles,
    }
    return Object.values(st.puzzles ?? {}).some((puzzle) => {
      if (state.solvedPuzzles.includes(puzzle.id)) return false
      const explicitlyPlaced = Object.values(st.nodes).some((node) => node.puzzles?.includes(puzzle.id))
      if (explicitlyPlaced && !st.nodes[nodeId]?.puzzles?.includes(puzzle.id)) return false
      return evalCondition(puzzle.requires, ctx)
    })
  }

  /** 枚举当前可解决谜题的状态组合（含暂不解谜）。 */
  function puzzleVariants(st: Story, nodeId: string, initial: SimVariant, depth: number): SimVariant[] {
    const variants: SimVariant[] = [{ state: cloneState(initial.state), actions: [] }]
    const seen = new Set<string>([''])
    for (let index = 0; index < variants.length; index++) {
      const current = variants[index]
      const currentState = current.state
      const ctx: ConditionContext = {
        vars: currentState.vars, inventory: currentState.inventory, steps: depth, endingId: null,
        visited: currentState.visited, docs: currentState.docs, day: currentState.day,
        world: currentState.world, phase: currentState.phase,
        violations: currentState.violations, evidence: currentState.evidence, deductions: currentState.deductions,
        relations: currentState.relations, memories: currentState.memories,
        revealedSecrets: currentState.revealedSecrets, solvedPuzzles: currentState.solvedPuzzles,
      }
      for (const puzzle of Object.values(st.puzzles ?? {})) {
        const explicitlyPlaced = Object.values(st.nodes).some((node) => node.puzzles?.includes(puzzle.id))
        if (explicitlyPlaced && !st.nodes[nodeId]?.puzzles?.includes(puzzle.id)) continue
        if (currentState.solvedPuzzles.includes(puzzle.id) || !evalCondition(puzzle.requires, ctx)) continue
        const next = cloneState(currentState)
        next.solvedPuzzles.push(puzzle.id)
        applySimEffects(puzzle.onSolved, next)
        const key = [...next.solvedPuzzles].sort().join('\u0000')
        if (!seen.has(key)) {
          seen.add(key)
          variants.push({
            state: next,
            actions: [...current.actions, { type: 'puzzle', nodeId, puzzleId: puzzle.id }],
          })
        }
      }
    }
    return variants
  }

  /** 枚举玩家在当前证据下可以选择确认的推论状态（含一个都不确认）。 */
  function deductionVariants(st: Story, nodeId: string, initialState: SimState): SimVariant[] {
    const variants: SimVariant[] = [{ state: cloneState(initialState), actions: [] }]
    const seen = new Set<string>([''])
    for (let index = 0; index < variants.length; index++) {
      const current = variants[index]
      const currentState = current.state
      for (const deduction of Object.values(st.deductions ?? {})) {
        if (currentState.deductions.includes(deduction.id)) continue
        const owned = new Set(currentState.evidence)
        const canConfirm =
          (deduction.requires.all ?? []).every((id) => owned.has(id)) &&
          (deduction.requires.anyOf ?? []).every((group) => group.some((id) => owned.has(id)))
        if (!canConfirm) continue
        const next = cloneState(currentState)
        next.deductions.push(deduction.id)
        applySimEffects(deduction.onConfirmed, next)
        const key = [...next.deductions].sort().join('\u0000')
        if (!seen.has(key)) {
          if (variants.length >= maxDeductionVariants) {
            coverageReasons.add('deduction_variants')
            warn(`节点推论组合超过 ${maxDeductionVariants} 种，已截断探索`)
            return variants
          }
          seen.add(key)
          variants.push({
            state: next,
            actions: [
              ...current.actions,
              {
                type: 'deduction',
                nodeId,
                deductionId: deduction.id,
                evidence: selectedEvidence(deduction.requires, owned),
              },
            ],
          })
        }
      }
    }
    return variants
  }

  /** 注入关系上下限，并把 EffectTarget 的标量状态回写到模拟状态。 */
  function applySimEffects(effects: Parameters<typeof applyEffects>[0], state: SimState): void {
    const target = { ...state, relationLimits }
    applyEffects(effects, target, rand)
    state.day = target.day
    state.world = target.world ?? state.world
    state.phase = target.phase ?? state.phase
  }

  const coverageComplete = coverageReasons.size === 0
  let witnessSearchUsed = 0
  if (!targetEndingId && !coverageComplete) {
    for (const endingId of Object.keys(story.endings)) {
      if (witnesses.has(endingId)) continue
      const targeted = walkAllEndings(story, {
        ...options,
        maxStates: witnessMaxStates,
        diagnostics: false,
        targetEndingId: endingId,
      })
      witnessSearchUsed += targeted.nodesVisited
      const witness = targeted.reachability.witnesses.find((item) => item.endingId === endingId)
      if (witness) witnesses.set(endingId, { ...witness, source: 'targeted' })
    }
  }

  const endingMap = new Map<string, EndingReach>(Object.keys(counts)
    .map((endingId) => ({
      endingId,
      paths: counts[endingId],
      minSteps: minSteps[endingId] ?? 0,
    }))
    .map((item) => [item.endingId, item]))
  for (const witness of witnesses.values()) {
    if (!endingMap.has(witness.endingId)) {
      endingMap.set(witness.endingId, {
        endingId: witness.endingId,
        paths: 1,
        minSteps: witness.steps,
      })
    }
  }
  const endings = [...endingMap.values()].sort((a, b) => a.endingId.localeCompare(b.endingId))

  const endingWitnesses = [...witnesses.values()].sort((a, b) => a.endingId.localeCompare(b.endingId))
  const provenEndings = endingWitnesses.map((item) => item.endingId)
  const unprovenEndings = Object.keys(story.endings).filter((id) => !witnesses.has(id))
  // 兼容旧字段；coverage 不完整时应按“尚未证明”理解，而不是数学上的不可达。
  const unreachableEndings = unprovenEndings

  const utilization = maxStates > 0 ? nodesVisited / maxStates : 1
  if (!truncated && utilization >= 0.8) {
    warn(
      `路径探索状态预算已使用 ${(utilization * 100).toFixed(1)}%（${nodesVisited}/${maxStates}），` +
      '作品接近截断上限；请用 diagnostics 查看 hotNodes，并收敛高频回环或过早展开的推论组合',
    )
  }
  if (!targetEndingId && !coverageComplete && unprovenEndings.length === 0) {
    warn('全状态覆盖未完成，但每个登记结局都已有可重放见证路径；这不能证明作品不存在其他死路')
  }
  if (!targetEndingId && failureWitnesses.size > 0) {
    const softLocks = [...failureWitnesses.values()].filter((item) => item.kind === 'soft_lock').length
    const invalidTerminals = failureWitnesses.size - softLocks
    warn(`发现 ${failureWitnesses.size} 条可重放失败路径（条件软锁 ${softLocks}，无结局终点 ${invalidTerminals}）`)
  }
  const hotNodes = diagnostics
    ? Object.entries(nodeVisits)
      .map(([nodeId, visits]) => ({ nodeId, visits }))
      .sort((a, b) => b.visits - a.visits || a.nodeId.localeCompare(b.nodeId))
      .slice(0, topNodes)
    : undefined

  return {
    endings,
    unreachableEndings,
    maxDepth: deepest,
    nodesVisited,
    budget: { used: nodesVisited, limit: maxStates, utilization },
    hotNodes,
    truncated,
    reachability: {
      allEndingsProven: unprovenEndings.length === 0,
      provenEndings,
      unprovenEndings,
      witnesses: endingWitnesses,
      witnessSearch: { used: witnessSearchUsed, limitPerEnding: witnessMaxStates },
    },
    coverage: {
      complete: coverageComplete,
      reasons: [...coverageReasons].sort(),
    },
    failures: {
      complete: coverageComplete,
      witnesses: [...failureWitnesses.values()].sort((a, b) =>
        a.nodeId.localeCompare(b.nodeId) || a.kind.localeCompare(b.kind)),
    },
    warnings,
  }
}

function selectedEvidence(requirement: DeductionRequirement, owned: ReadonlySet<string>): string[] {
  const selected = new Set<string>()
  for (const id of requirement.all ?? []) {
    if (owned.has(id)) selected.add(id)
  }
  for (const group of requirement.anyOf ?? []) {
    const id = group.find((candidate) => owned.has(candidate))
    if (id) selected.add(id)
  }
  return [...selected]
}

/** 忽略条件计算每个节点到目标结局的最短图距离，仅用于调整搜索顺序，不用于剪枝。 */
function distancesToEnding(story: Story, endingId: string): Map<string, number> {
  const reverse = new Map<string, string[]>()
  for (const node of Object.values(story.nodes)) {
    for (const choice of node.choices) {
      const parents = reverse.get(choice.target) ?? []
      parents.push(node.id)
      reverse.set(choice.target, parents)
    }
  }
  const targets = Object.values(story.nodes)
    .filter((node) => node.ending?.id === endingId)
    .map((node) => node.id)
  const distances = new Map<string, number>()
  const queue = targets.map((nodeId) => ({ nodeId, distance: 0 }))
  for (const target of targets) distances.set(target, 0)
  while (queue.length > 0) {
    const { nodeId, distance } = queue.shift()!
    for (const parent of reverse.get(nodeId) ?? []) {
      if (distances.has(parent)) continue
      distances.set(parent, distance + 1)
      queue.push({ nodeId: parent, distance: distance + 1 })
    }
  }
  return distances
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
    world: s.world,
    phase: s.phase,
    visited: [...s.visited],
  }
}

function simStateKey(state: SimState, relevantVisitedIds?: ReadonlySet<string>): string {
  const sortedRecord = <T>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
  return JSON.stringify({
    vars: sortedRecord(state.vars),
    inventory: [...state.inventory].sort(),
    docs: [...state.docs].sort(),
    evidence: [...state.evidence].sort(),
    deductions: [...state.deductions].sort(),
    relations: Object.fromEntries(
      Object.entries(state.relations)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([characterId, stats]) => [characterId, sortedRecord(stats)]),
    ),
    memories: [...state.memories].sort(),
    revealedSecrets: [...state.revealedSecrets].sort(),
    solvedPuzzles: [...state.solvedPuzzles].sort(),
    violations: [...state.violations].sort(),
    day: state.day,
    world: state.world,
    phase: state.phase,
    visited: state.visited
      .filter((nodeId) => !relevantVisitedIds || relevantVisitedIds.has(nodeId))
      .sort(),
  })
}

function collectRelevantVisitedIds(story: Story): Set<string> {
  const ids = new Set<string>()
  const visit = (condition: Parameters<typeof evalCondition>[0]): void => {
    if (!condition) return
    if (condition.var === '#visited' && condition.value !== undefined) {
      ids.add(String(condition.value))
    }
    for (const child of condition.and ?? []) visit(child)
    for (const child of condition.or ?? []) visit(child)
    visit(condition.not)
  }
  for (const node of Object.values(story.nodes)) {
    for (const choice of node.choices) visit(choice.when)
  }
  for (const puzzle of Object.values(story.puzzles ?? {})) visit(puzzle.requires)
  return ids
}
