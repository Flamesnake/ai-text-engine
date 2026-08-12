import type { Effects, Vars } from './types.js'

/** 效果应用目标 */
export interface EffectTarget {
  vars: Vars
  inventory: string[]
  docs: string[]
}

/** 应用效果到状态（set / add / gain / lose / gainDocs / flag） */
export function applyEffects(effects: Effects | undefined, target: EffectTarget): void {
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
  if (effects.flag) {
    // 旗标与变量同命名空间（语义区分，存储一致），条件 eq/exists 可直接引用
    for (const [k, v] of Object.entries(effects.flag)) {
      target.vars[k] = v
    }
  }
}
