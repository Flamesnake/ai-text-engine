import type { Condition, VarValue, Vars } from './types.js'

/** 条件求值所需的状态上下文 */
export interface ConditionContext {
  vars: Vars
  inventory: string[]
  /** 已走步数（history 长度） */
  steps?: number
  /** 当前结局 id（未到达结局时为 null） */
  endingId?: string | null
  /** 去重后的已访问节点 */
  visited?: string[]
  /** 已获得的线索/文档 id */
  docs?: string[]
  /** 当前天数 */
  day?: number
  /** 已违反的规则 id */
  violations?: string[]
}

/** 特殊变量（以 # 开头）：#steps / #ending / #visited */
const SPECIAL_PREFIX = '#'

/** 比较两个值；数字按数值比较，其余按 === */
function compare(op: Condition['op'], left: VarValue | undefined, right: VarValue | undefined): boolean {
  switch (op) {
    case 'eq':
      return left === right
    case 'ne':
      return left !== right
    case 'gt':
      return Number(left) > Number(right)
    case 'gte':
      return Number(left) >= Number(right)
    case 'lte':
      return Number(left) <= Number(right)
    case 'lt':
      return Number(left) < Number(right)
    default:
      return false
  }
}

/**
 * 求值条件表达式。undefined / 空对象视为「通过」。
 * - `has` / `not_has`：道具包含检查（var 为道具名）；
 * - `exists`：变量已定义检查；
 * - 其余：vars[var] 与 value 比较。
 */
export function evalCondition(cond: Condition | undefined, ctx: ConditionContext): boolean {
  if (!cond) return true

  if (cond.and) {
    if (!cond.and.every((c) => evalCondition(c, ctx))) return false
  }
  if (cond.or) {
    if (!cond.or.some((c) => evalCondition(c, ctx))) return false
  }
  if (cond.not) {
    if (evalCondition(cond.not, ctx)) return false
  }

  // 组合条件可以不带自身比较；仅当定义了 op 时才做自身判断
  if (!cond.op) return true

  if (cond.op === 'has' || cond.op === 'not_has') {
    const has = cond.var !== undefined && ctx.inventory.includes(cond.var)
    return cond.op === 'has' ? has : !has
  }
  if (cond.op === 'exists') {
    const exists =
      cond.var !== undefined &&
      (cond.var.startsWith(SPECIAL_PREFIX) || cond.var in ctx.vars)
    return exists
  }

  // 特殊变量：成就/条件使用的运行时状态（#steps / #ending / #visited）
  if (cond.var?.startsWith(SPECIAL_PREFIX)) {
    return evalSpecial(cond, ctx)
  }

  const left = cond.var !== undefined ? ctx.vars[cond.var] : undefined
  return compare(cond.op, left, cond.value)
}

function evalSpecial(cond: Condition, ctx: ConditionContext): boolean {
  switch (cond.var) {
    case '#steps':
      return compare(cond.op, ctx.steps ?? 0, cond.value)
    case '#ending':
      return compare(cond.op, ctx.endingId ?? undefined, cond.value)
    case '#visited': {
      const visited =
        cond.value !== undefined && (ctx.visited ?? []).includes(String(cond.value))
      return cond.op === 'eq' ? visited : cond.op === 'ne' ? !visited : false
    }
    case '#docs': {
      const has = cond.value !== undefined && (ctx.docs ?? []).includes(String(cond.value))
      return cond.op === 'eq' ? has : cond.op === 'ne' ? !has : false
    }
    case '#day':
      return compare(cond.op, ctx.day ?? 1, cond.value)
    case '#violated': {
      const has =
        cond.value !== undefined && (ctx.violations ?? []).includes(String(cond.value))
      return cond.op === 'eq' ? has : cond.op === 'ne' ? !has : false
    }
    default:
      return false
  }
}
