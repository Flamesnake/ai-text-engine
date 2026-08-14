import type { Condition, Effects, Story, StoryNode } from './types.js'
import { walkAllEndings, type WalkResult } from './walk.js'

export type EvaluationSeverity = 'info' | 'warning'

export interface EvaluationFinding {
  code: string
  severity: EvaluationSeverity
  message: string
  evidence?: string[]
}

export interface StoryEvaluation {
  summary: {
    nodes: number
    endings: number
    choices: number
    textChars: number
    documents: number
    evidence: number
    deductions: number
    characters: number
    puzzles: number
  }
  interaction: {
    nonEndingNodes: number
    singleChoiceNodes: number
    singleChoiceRatio: number
    longestSingleChoiceRun: number
    effectfulChoices: number
    effectfulChoiceRatio: number
    conditionalChoices: number
    conditionalChoiceRatio: number
    selfLoopChoices: number
    duplicateOutcomeGroups: number
    repeatedLabels: Array<{ label: string; count: number }>
  }
  mechanics: {
    puzzles: { defined: number; placed: number; gatedChoices: number; unrecovered: string[] }
    deductions: { defined: number; gatedChoices: number; withEffects: number; unrecovered: string[] }
    evidence: { defined: number; gainSites: number; unrecovered: string[] }
    relationships: {
      characters: number
      secrets: number
      effectfulChoices: number
      gatedChoices: number
    }
  }
  presentation: {
    globalRecipe: boolean
    nodeOverrides: number
    blocksNodes: number
    segmentNodes: number
    segments: number
    conditionalSegments: number
    segmentStyleUsage: Array<{ name: string; count: number }>
    sfxNodes: number
    fxNodes: number
    sfxUsage: Array<{ name: string; count: number }>
    fxUsage: Array<{ name: string; count: number }>
  }
  performance: { walk: WalkResult }
  findings: EvaluationFinding[]
}

/**
 * 对作品返回事实指标与带证据的候选问题。它不打总分，也不假设某题材必须采用某种机制。
 */
export function evaluateStory(story: Story): StoryEvaluation {
  const nodes = Object.values(story.nodes)
  const nonEnding = nodes.filter((node) => !node.ending)
  const choiceEntries = nodes.flatMap((node) => node.choices.map((choice) => ({ node, choice })))
  const choices = choiceEntries.map((entry) => entry.choice)
  const singleChoiceNodes = nonEnding.filter((node) => node.choices.length === 1).length
  const effectfulChoices = choices.filter((choice) => hasEffects(choice.effects)).length
  const conditionalChoices = choices.filter((choice) => choice.when !== undefined).length
  const repeatedLabels = countBy(choices.map((choice) => choice.label.trim()))
    .filter((item) => item.count >= 3 && item.label.length > 0)
  const selfLoopEntries = choiceEntries.filter(({ node, choice }) =>
    choice.target === node.id && !hasEffects(choice.effects) && !hasEffects(node.onEnter))
  const duplicateOutcomeEntries = nodes.flatMap((node) => {
    const groups = new Map<string, string[]>()
    for (const choice of node.choices) {
      const key = stableSerialize({ target: choice.target, when: choice.when ?? null, effects: choice.effects ?? null })
      const labels = groups.get(key) ?? []
      labels.push(choice.label)
      groups.set(key, labels)
    }
    return [...groups.values()]
      .filter((labels) => labels.length > 1)
      .map((labels) => ({ nodeId: node.id, labels }))
  })
  const sfxUsage = countBy(nodes.flatMap((node) => node.sfx ? [node.sfx] : []), 'name')
  const fxUsage = countBy(nodes.flatMap((node) => (node.fx ?? []).map((fx) =>
    typeof fx === 'string' ? fx : fx.name)), 'name')
  const segments = nodes.flatMap((node) => (node.blocks ?? []).flatMap((block) => block.segments ?? []))
  const segmentStyleUsage = countBy(segments.flatMap((segment) => segment.style ? [segment.style] : []), 'name')
  const consecutiveDroneEdges = [...new Set(nodes.flatMap((node) =>
    node.sfx === 'drone'
      ? node.choices
        .filter((choice) => story.nodes[choice.target]?.sfx === 'drone')
        .map((choice) => `${node.id} -> ${choice.target}`)
      : []))]
  const systemSfxNodes = nodes.filter((node) =>
    node.sfx !== undefined && ['click', 'page', 'achievement', 'ending_good', 'ending_bad', 'ending_true', 'ending_hidden']
      .includes(node.sfx))
  const disruptiveFx = new Set(['shake', 'flicker', 'glitch', 'unstable'])
  const longReadingStrongFx = nodes.filter((node) =>
    nodeTextLength(node) >= 600 && (node.fx ?? []).some((item) => {
      const spec = typeof item === 'string' ? { name: item, intensity: 1 } : { ...item, intensity: item.intensity ?? 1 }
      return disruptiveFx.has(spec.name) && spec.intensity >= 0.8
    }))
  const highIntensityFx = nodes.filter((node) => (node.fx ?? []).some((item) =>
    typeof item !== 'string' && (item.intensity ?? 1) >= 1.5))
  const walk = walkAllEndings(story, { diagnostics: true, topNodes: 8 })

  const puzzleIds = new Set(Object.keys(story.puzzles ?? {}))
  const placedPuzzles = new Set(nodes.flatMap((node) => node.puzzles ?? []).filter((id) => puzzleIds.has(id)))
  const puzzleGates = choices.filter((choice) => conditionRefs(choice.when, '#puzzle').length > 0).length
  const deductionGates = choices.filter((choice) => conditionRefs(choice.when, '#deduction').length > 0).length
  const relationshipGates = choices.filter((choice) => conditionHasRelationshipRef(choice.when, story)).length
  const relationshipEffects = choices.filter((choice) =>
    (choice.effects?.adjustRelation?.length ?? 0) > 0 ||
    (choice.effects?.remember?.length ?? 0) > 0 ||
    (choice.effects?.revealSecrets?.length ?? 0) > 0,
  ).length
  const evidenceGainSites = nodes.filter((node) => (node.onEnter?.gainEvidence?.length ?? 0) > 0).length +
    choices.filter((choice) => (choice.effects?.gainEvidence?.length ?? 0) > 0).length +
    Object.values(story.puzzles ?? {}).filter((puzzle) => (puzzle.onSolved?.gainEvidence?.length ?? 0) > 0).length
  const allConditions = [
    ...choices.map((choice) => choice.when),
    ...Object.values(story.puzzles ?? {}).map((puzzle) => puzzle.requires),
    ...(story.achievements ?? []).map((achievement) => achievement.when),
  ]
  const directlyReferencedDeductions = conditionRefSet(allConditions, '#deduction')
  const directlyReferencedPuzzles = conditionRefSet(allConditions, '#puzzle')
  const directlyReferencedEvidence = conditionRefSet(allConditions, '#evidence')
  const recoveredDeductions = new Set(Object.values(story.deductions ?? {})
    .filter((deduction) => directlyReferencedDeductions.has(deduction.id) || hasEffects(deduction.onConfirmed))
    .map((deduction) => deduction.id))
  const recoveredPuzzles = new Set(Object.values(story.puzzles ?? {})
    .filter((puzzle) => directlyReferencedPuzzles.has(puzzle.id) || hasEffects(puzzle.onSolved))
    .map((puzzle) => puzzle.id))
  const recoveredEvidence = new Set(directlyReferencedEvidence)
  for (const deductionId of recoveredDeductions) {
    const requirement = story.deductions?.[deductionId]?.requires
    for (const id of requirement?.all ?? []) recoveredEvidence.add(id)
    for (const group of requirement?.anyOf ?? []) for (const id of group) recoveredEvidence.add(id)
  }
  const unrecoveredEvidence = Object.keys(story.evidence ?? {}).filter((id) => !recoveredEvidence.has(id)).sort()
  const unrecoveredDeductions = Object.keys(story.deductions ?? {}).filter((id) => !recoveredDeductions.has(id)).sort()
  const unrecoveredPuzzles = Object.keys(story.puzzles ?? {}).filter((id) => !recoveredPuzzles.has(id)).sort()

  const findings: EvaluationFinding[] = []
  const longestSingleChoiceRun = findLongestSingleChoiceRun(story)
  if (longestSingleChoiceRun >= 3) {
    findings.push({
      code: 'LONG_SINGLE_CHOICE_RUN',
      severity: 'warning',
      message: `最长连续单选项流程为 ${longestSingleChoiceRun} 个节点；请确认这些推进都具有叙事价值，而非可合并的点击走廊`,
    })
  }
  for (const item of repeatedLabels) {
    findings.push({
      code: 'REPEATED_NAVIGATION_LABEL',
      severity: 'info',
      message: `选项「${item.label}」重复 ${item.count} 次；可能是合理导航，也可能表示重复往返`,
      evidence: nodes
        .filter((node) => node.choices.some((choice) => choice.label.trim() === item.label))
        .map((node) => node.id)
        .slice(0, 10),
    })
  }
  if (selfLoopEntries.length > 0) {
    findings.push({
      code: 'NO_OP_SELF_LOOP', severity: 'info',
      message: `${selfLoopEntries.length} 个选项返回当前节点，且选项与重新进入节点都没有状态效果；请确认它们不是无反馈点击或刷步数入口`,
      evidence: selfLoopEntries.slice(0, 10).map(({ node, choice }) => `${node.id}: ${choice.label}`),
    })
  }
  if (duplicateOutcomeEntries.length > 0) {
    findings.push({
      code: 'DUPLICATE_CHOICE_OUTCOME', severity: 'info',
      message: `${duplicateOutcomeEntries.length} 个节点包含两个以上完全相同的目标、条件和效果；如果语气选择应被记住，请增加结构化后果`,
      evidence: duplicateOutcomeEntries.slice(0, 10).map((item) => `${item.nodeId}: ${item.labels.join(' / ')}`),
    })
  }
  if (puzzleIds.size > 0 && placedPuzzles.size < puzzleIds.size) {
    findings.push({
      code: 'UNPLACED_PUZZLES', severity: 'warning',
      message: `${puzzleIds.size - placedPuzzles.size} 个谜题未放置到场景`,
    })
  }
  addUnrecoveredFinding(findings, 'UNRECOVERED_EVIDENCE', '证据', unrecoveredEvidence,
    '没有被有效推论或条件引用；它可能只是阅读素材，也可能是尚未回收的调查结果')
  addUnrecoveredFinding(findings, 'UNRECOVERED_DEDUCTION', '推论', unrecoveredDeductions,
    '确认后既不产生效果，也不改变条件、行动或结局')
  addUnrecoveredFinding(findings, 'UNRECOVERED_PUZZLE', '谜题', unrecoveredPuzzles,
    '解开后既不产生效果，也不改变条件、行动或结局')
  const dominantSfx = sfxUsage[0]
  const sfxNodeCount = nodes.filter((node) => Boolean(node.sfx)).length
  if (nodes.length >= 5 && sfxNodeCount === nodes.length) {
    findings.push({
      code: 'SFX_EVERYWHERE', severity: 'info',
      message: `全部 ${nodes.length} 个节点都声明了手动 sfx；点击、翻页、成就和结局已有自动反馈，请确认节点音效都承担额外叙事作用`,
    })
  }
  if (dominantSfx && dominantSfx.count >= 5 && dominantSfx.count / Math.max(1, nodes.length) >= 0.6) {
    findings.push({
      code: 'DOMINANT_SFX', severity: 'info',
      message: `${dominantSfx.count}/${nodes.length} 个节点使用音效「${dominantSfx.name}」；请确认这是有意的声音母题而非机械铺满`,
    })
  }
  if (consecutiveDroneEdges.length > 0) {
    findings.push({
      code: 'CONSECUTIVE_DRONE', severity: 'info',
      message: `${consecutiveDroneEdges.length} 条相邻节点边连续触发 drone；短促节点音效会重新起音，请确认不是把持续声景误写成逐节点效果`,
      evidence: consecutiveDroneEdges.slice(0, 10),
    })
  }
  if (systemSfxNodes.length > 0) {
    findings.push({
      code: 'REDUNDANT_SYSTEM_SFX', severity: 'info',
      message: `${systemSfxNodes.length} 个节点手动声明 click/page/achievement/ending_*；这些反馈已有系统触发，节点 sfx 应承担额外叙事作用`,
      evidence: systemSfxNodes.slice(0, 10).map((node) => `${node.id}: ${node.sfx}`),
    })
  }
  if (longReadingStrongFx.length > 0) {
    findings.push({
      code: 'LONG_READING_STRONG_FX', severity: 'warning',
      message: `${longReadingStrongFx.length} 个长正文节点使用持续抖动、闪烁、故障或不稳定灯强效果，可能妨碍阅读；建议改为短促事件节点或降低强度`,
      evidence: longReadingStrongFx.slice(0, 10).map((node) => node.id),
    })
  }
  if (highIntensityFx.length > 0) {
    findings.push({
      code: 'HIGH_INTENSITY_FX', severity: 'info',
      message: `${highIntensityFx.length} 个节点使用 intensity >= 1.5 的强动画；请确认它们是少量叙事峰值并具有减弱动态回退`,
      evidence: highIntensityFx.slice(0, 10).map((node) => node.id),
    })
  }
  if (!walk.coverage.complete || walk.budget.utilization >= 0.8) {
    findings.push({
      code: !walk.coverage.complete ? 'WALK_COVERAGE_INCOMPLETE' : 'WALK_BUDGET_HIGH',
      severity: 'warning',
      message: !walk.coverage.complete
        ? walk.reachability.allEndingsProven
          ? `全状态覆盖未完成（${walk.coverage.reasons.join(', ')}），但 ${walk.reachability.provenEndings.length} 个结局均已有可重放见证；仍不能据此排除其他死路`
          : `全状态覆盖未完成（${walk.coverage.reasons.join(', ')}），仍有 ${walk.reachability.unprovenEndings.length} 个结局尚未找到见证路径`
        : `路径探索使用 ${(walk.budget.utilization * 100).toFixed(1)}% 状态预算`,
      evidence: walk.hotNodes?.slice(0, 5).map((item) => `${item.nodeId}: ${item.visits}`),
    })
  }
  if (walk.failures.witnesses.length > 0) {
    const softLocks = walk.failures.witnesses.filter((item) => item.kind === 'soft_lock').length
    const invalidTerminals = walk.failures.witnesses.length - softLocks
    findings.push({
      code: 'WALK_FAILURE_PATHS',
      severity: 'warning',
      message: `路径探索找到 ${walk.failures.witnesses.length} 条可重放失败路径：条件软锁 ${softLocks}，无结局终点 ${invalidTerminals}` +
        `${walk.failures.complete ? '' : '；全状态覆盖未完成，可能还有未发现路径'}`,
      evidence: walk.failures.witnesses.slice(0, 10).map((item) => `${item.kind}: ${item.nodeId}`),
    })
  }

  return {
    summary: {
      nodes: nodes.length,
      endings: Object.keys(story.endings).length,
      choices: choices.length,
      textChars: nodes.reduce((sum, node) => sum + node.text.length, 0),
      documents: Object.keys(story.documents ?? {}).length,
      evidence: Object.keys(story.evidence ?? {}).length,
      deductions: Object.keys(story.deductions ?? {}).length,
      characters: Object.keys(story.characters ?? {}).length,
      puzzles: puzzleIds.size,
    },
    interaction: {
      nonEndingNodes: nonEnding.length,
      singleChoiceNodes,
      singleChoiceRatio: ratio(singleChoiceNodes, nonEnding.length),
      longestSingleChoiceRun,
      effectfulChoices,
      effectfulChoiceRatio: ratio(effectfulChoices, choices.length),
      conditionalChoices,
      conditionalChoiceRatio: ratio(conditionalChoices, choices.length),
      selfLoopChoices: selfLoopEntries.length,
      duplicateOutcomeGroups: duplicateOutcomeEntries.length,
      repeatedLabels,
    },
    mechanics: {
      puzzles: {
        defined: puzzleIds.size, placed: placedPuzzles.size, gatedChoices: puzzleGates,
        unrecovered: unrecoveredPuzzles,
      },
      deductions: {
        defined: Object.keys(story.deductions ?? {}).length,
        gatedChoices: deductionGates,
        withEffects: Object.values(story.deductions ?? {}).filter((item) => hasEffects(item.onConfirmed)).length,
        unrecovered: unrecoveredDeductions,
      },
      evidence: {
        defined: Object.keys(story.evidence ?? {}).length,
        gainSites: evidenceGainSites,
        unrecovered: unrecoveredEvidence,
      },
      relationships: {
        characters: Object.keys(story.characters ?? {}).length,
        secrets: Object.values(story.characters ?? {}).reduce((sum, item) => sum + Object.keys(item.secrets ?? {}).length, 0),
        effectfulChoices: relationshipEffects,
        gatedChoices: relationshipGates,
      },
    },
    presentation: {
      globalRecipe: Object.keys(story.meta.presentation ?? {}).length > 0,
      nodeOverrides: nodes.filter((node) => Object.keys(node.presentation ?? {}).length > 0).length,
      blocksNodes: nodes.filter((node) => (node.blocks?.length ?? 0) > 0).length,
      segmentNodes: nodes.filter((node) => (node.blocks ?? []).some((block) => (block.segments?.length ?? 0) > 0)).length,
      segments: segments.length,
      conditionalSegments: segments.filter((segment) => segment.revealWhen !== undefined).length,
      segmentStyleUsage,
      sfxNodes: sfxNodeCount,
      fxNodes: nodes.filter((node) => (node.fx?.length ?? 0) > 0).length,
      sfxUsage,
      fxUsage,
    },
    performance: { walk },
    findings,
  }
}

function ratio(value: number, total: number): number {
  return total > 0 ? Number((value / total).toFixed(4)) : 0
}

function countBy(values: string[], key: 'label' | 'name' = 'label'): Array<Record<typeof key, string> & { count: number }> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .map(([value, count]) => ({ [key]: value, count }) as Record<typeof key, string> & { count: number })
    .sort((a, b) => b.count - a.count || a[key].localeCompare(b[key]))
}

function hasEffects(effects: Effects | undefined): boolean {
  if (!effects) return false
  return Object.values(effects).some((value) =>
    Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Object.keys(value).length > 0 : value !== undefined,
  )
}

function conditionRefs(condition: Condition | undefined, specialVar: string): string[] {
  if (!condition) return []
  const out: string[] = []
  if (condition.var === specialVar && condition.value !== undefined) out.push(String(condition.value))
  for (const child of condition.and ?? []) out.push(...conditionRefs(child, specialVar))
  for (const child of condition.or ?? []) out.push(...conditionRefs(child, specialVar))
  out.push(...conditionRefs(condition.not, specialVar))
  return out
}

function conditionRefSet(conditions: Array<Condition | undefined>, specialVar: string): Set<string> {
  return new Set(conditions.flatMap((condition) => conditionRefs(condition, specialVar)))
}

function addUnrecoveredFinding(
  findings: EvaluationFinding[],
  code: string,
  label: string,
  ids: string[],
  explanation: string,
): void {
  if (ids.length === 0) return
  findings.push({
    code, severity: 'info',
    message: `${ids.length} 个${label}${explanation}`,
    evidence: ids.slice(0, 10),
  })
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function nodeTextLength(node: StoryNode): number {
  if ((node.blocks?.length ?? 0) > 0) {
    return node.blocks!.reduce((sum, block) => sum + block.text.length + (block.title?.length ?? 0), 0)
  }
  return node.text.length
}

function conditionHasRelationshipRef(condition: Condition | undefined, story: Story): boolean {
  if (!condition) return false
  const characterIds = new Set(Object.keys(story.characters ?? {}))
  if (
    condition.var === '#memory' ||
    condition.var === '#secret' ||
    (condition.var?.startsWith('#relation:') && characterIds.has(condition.var.split(':')[1] ?? ''))
  ) return true
  return [...(condition.and ?? []), ...(condition.or ?? []), ...(condition.not ? [condition.not] : [])]
    .some((child) => conditionHasRelationshipRef(child, story))
}

function findLongestSingleChoiceRun(story: Story): number {
  let longest = 0
  const visit = (node: StoryNode, seen: Set<string>, length: number): void => {
    if (seen.has(node.id)) return
    const nextLength = node.ending ? 0 : node.choices.length === 1 ? length + 1 : 0
    longest = Math.max(longest, nextLength)
    const nextSeen = new Set(seen).add(node.id)
    for (const choice of node.choices) {
      const target = story.nodes[choice.target]
      if (target) visit(target, nextSeen, nextLength)
    }
  }
  const start = story.nodes[story.start]
  if (start) visit(start, new Set(), 0)
  return longest
}
