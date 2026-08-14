import type { Effects, Vars } from './types.js'

/** 效果应用目标 */
export interface EffectTarget {
  vars: Vars
  inventory: string[]
  docs: string[]
  /** 当前天数（day 效果累加后回写） */
  day: number
  world?: string
  phase?: string
  /** 违规记录（去重） */
  violations: string[]
  /** 已获得证据；旧调用者未提供时忽略 gainEvidence */
  evidence?: string[]
  relations?: Record<string, Record<string, number>>
  relationLimits?: Record<string, Record<string, { min?: number; max?: number }>>
  memories?: string[]
  revealedSecrets?: string[]
}

/**
 * 应用效果到状态（set / add / rand / violation / day / gain / lose / gainDocs / flag）。
 * `rand` 为随机源（默认 Math.random），可注入固定值以获得确定性结果。
 */
export function applyEffects(
  effects: Effects | undefined,
  target: EffectTarget,
  rand: () => number = Math.random,
): void {
  if (!effects) return

  if (effects.set) {
    for (const [k, v] of Object.entries(effects.set)) {
      target.vars[k] = v
    }
  }
  if (effects.add) {
    for (const [k, delta] of Object.entries(effects.add)) {
      const current = typeof target.vars[k] === 'number' ? (target.vars[k] as number) : 0
      target.vars[k] = current + delta
    }
  }
  if (effects.rand) {
    for (const r of effects.rand) {
      if (Number.isFinite(r.min) && Number.isFinite(r.max) && r.max >= r.min) {
        target.vars[r.var] = Math.floor(rand() * (r.max - r.min + 1)) + r.min
      }
    }
  }
  if (effects.violation) {
    for (const ruleId of effects.violation) {
      if (!target.violations.includes(ruleId)) target.violations.push(ruleId)
    }
  }
  if (effects.day !== undefined) {
    target.day = Math.max(1, target.day + effects.day)
  }
  if (effects.world !== undefined) target.world = effects.world
  if (effects.phase !== undefined) target.phase = effects.phase
  if (effects.gain) {
    for (const item of effects.gain) {
      if (!target.inventory.includes(item)) target.inventory.push(item)
    }
  }
  if (effects.lose) {
    for (const item of effects.lose) {
      const idx = target.inventory.indexOf(item)
      if (idx >= 0) target.inventory.splice(idx, 1)
    }
  }
  if (effects.gainDocs) {
    for (const docId of effects.gainDocs) {
      if (!target.docs.includes(docId)) target.docs.push(docId)
    }
  }
  if (effects.gainEvidence) {
    for (const evidenceId of effects.gainEvidence) {
      if (target.evidence && !target.evidence.includes(evidenceId)) target.evidence.push(evidenceId)
    }
  }
  if (effects.adjustRelation && target.relations) {
    for (const change of effects.adjustRelation) {
      const stats = target.relations[change.characterId]
      if (!stats || typeof stats[change.stat] !== 'number') continue
      const limits = target.relationLimits?.[change.characterId]?.[change.stat]
      stats[change.stat] = Math.max(
        limits?.min ?? -Infinity,
        Math.min(limits?.max ?? Infinity, stats[change.stat] + change.add),
      )
    }
  }
  if (effects.remember && target.memories) {
    for (const memory of effects.remember) if (!target.memories.includes(memory)) target.memories.push(memory)
  }
  if (effects.revealSecrets && target.revealedSecrets) {
    for (const secret of effects.revealSecrets) {
      if (!target.revealedSecrets.includes(secret)) target.revealedSecrets.push(secret)
    }
  }
  if (effects.flag) {
    // 旗标与变量同命名空间（语义区分，存储一致），条件 eq/exists 可直接引用
    for (const [k, v] of Object.entries(effects.flag)) {
      target.vars[k] = v
    }
  }
}
