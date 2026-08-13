import type { Condition, Effects, Story } from './types.js'

/**
 * 剧情数据静态校验（开发期 / AI 编辑后调用）。
 * 返回全部问题描述；空数组 = 通过。
 *
 * 检查项：
 * 1. 起始节点存在；
 * 2. 选项 target 断链；
 * 3. 结局节点规范（choices 空 ↔ 带 ending）；
 * 4. 结局登记一致性（endings 表 ↔ 节点）；
 * 5. 不可达节点（忽略条件，BFS）；
 * 6. 条件 / 插值引用的变量或道具从未被任何效果写过（疑似拼写错误）。
 */
export function validate(story: Story): string[] {
  const problems: string[] = []

  if (!story.nodes[story.start]) {
    problems.push(`起始节点 "${story.start}" 不存在`)
  }

  // 收集所有被写入过的变量 / 道具 / 旗标 / 文档
  const writtenVars = new Set<string>()
  const writtenItems = new Set<string>()
  const writtenDocs = new Set<string>()
  const gainedEvidence = new Set<string>()
  for (const node of Object.values(story.nodes)) {
    collectEffects(node.onEnter, writtenVars, writtenItems, writtenDocs, gainedEvidence)
    for (const choice of node.choices) {
      collectEffects(choice.effects, writtenVars, writtenItems, writtenDocs, gainedEvidence)
      if (choice.target && !story.nodes[choice.target]) {
        problems.push(
          `节点 "${node.id}" 的选项「${choice.label}」指向不存在的节点 "${choice.target}"`,
        )
      }
    }
    if (node.choices.length === 0 && !node.ending) {
      problems.push(`节点 "${node.id}" 没有选项也没有 ending 元数据（悬空结局）`)
    }
    if (node.choices.length > 0 && node.ending) {
      problems.push(`节点 "${node.id}" 既有选项又带 ending 元数据（语义冲突）`)
    }
    if (node.ending && !story.endings[node.ending.id]) {
      problems.push(`节点 "${node.id}" 的结局 "${node.ending.id}" 未登记在 story.endings 中`)
    }
    if (node.ending && !node.ending.title) {
      problems.push(`节点 "${node.id}" 的结局缺少 title`)
    }
    // 文本块规范
    for (const block of node.blocks ?? []) {
      if (!block.text) {
        problems.push(`节点 "${node.id}" 存在无正文的文本块`)
      }
      if (block.type === 'title' && !block.title) {
        problems.push(`节点 "${node.id}" 的 title 文本块缺少 title 字段`)
      }
    }
  }

  // 文档表：条目完整 + gainDocs 引用存在
  for (const [docId, doc] of Object.entries(story.documents ?? {})) {
    if (!doc.title) problems.push(`文档 "${docId}" 缺少 title`)
    if (!doc.text) problems.push(`文档 "${docId}" 缺少 text 正文`)
  }
  for (const docId of writtenDocs) {
    if (!story.documents?.[docId]) {
      problems.push(`gainDocs 引用了不存在的文档 "${docId}"（story.documents 中未定义）`)
    }
  }

  // 证据与推论：定义完整、所有引用存在、推论至少有一项证据要求
  for (const evidenceId of gainedEvidence) {
    if (!story.evidence?.[evidenceId]) {
      problems.push(`gainEvidence 引用了不存在的证据 "${evidenceId}"`)
    }
  }
  for (const [evidenceId, evidence] of Object.entries(story.evidence ?? {})) {
    if (evidence.id !== evidenceId) problems.push(`证据键 "${evidenceId}" 与 id "${evidence.id}" 不一致`)
    if (!evidence.title) problems.push(`证据 "${evidenceId}" 缺少 title`)
    if (!evidence.description) problems.push(`证据 "${evidenceId}" 缺少 description`)
  }
  for (const [deductionId, deduction] of Object.entries(story.deductions ?? {})) {
    if (deduction.id !== deductionId) problems.push(`推论键 "${deductionId}" 与 id "${deduction.id}" 不一致`)
    if (!deduction.statement) problems.push(`推论 "${deductionId}" 缺少 statement`)
    const refs = [
      ...(deduction.requires.all ?? []),
      ...(deduction.requires.anyOf ?? []).flat(),
    ]
    if (refs.length === 0) problems.push(`推论 "${deductionId}" 没有任何证据要求`)
    for (const evidenceId of new Set(refs)) {
      if (!story.evidence?.[evidenceId]) {
        problems.push(`推论 "${deductionId}" 引用了不存在的证据 "${evidenceId}"`)
      }
    }
    collectEffects(deduction.onConfirmed, writtenVars, writtenItems, writtenDocs, gainedEvidence)
  }

  // 人物定义与关系/秘密引用
  for (const [characterId, character] of Object.entries(story.characters ?? {})) {
    if (character.id !== characterId) problems.push(`角色键 "${characterId}" 与 id "${character.id}" 不一致`)
    for (const [secretId, secret] of Object.entries(character.secrets ?? {})) {
      if (secret.id !== secretId) problems.push(`角色 "${characterId}" 的秘密键 "${secretId}" 与 id "${secret.id}" 不一致`)
    }
  }
  const validateRelationshipEffects = (effects: Effects | undefined): void => {
    for (const change of effects?.adjustRelation ?? []) {
      const character = story.characters?.[change.characterId]
      if (!character) problems.push(`关系效果引用了不存在的角色 "${change.characterId}"`)
      else if (!character.relations?.[change.stat]) {
        problems.push(`关系效果引用了角色 "${change.characterId}" 未定义的维度 "${change.stat}"`)
      }
    }
    for (const ref of effects?.revealSecrets ?? []) {
      const [characterId, secretId] = splitRef(ref)
      if (!characterId || !secretId || !story.characters?.[characterId]?.secrets?.[secretId]) {
        problems.push(`秘密效果引用了不存在的秘密 "${ref}"`)
      }
    }
  }
  for (const node of Object.values(story.nodes)) {
    validateRelationshipEffects(node.onEnter)
    for (const choice of node.choices) {
      validateRelationshipEffects(choice.effects)
      for (const relationVar of collectRelationVars(choice.when)) {
        const [, characterId, stat] = relationVar.split(':')
        const character = story.characters?.[characterId]
        if (!character) problems.push(`关系条件引用了不存在的角色 "${characterId}"`)
        else if (!character.relations?.[stat]) {
          problems.push(`关系条件引用了角色 "${characterId}" 未定义的维度 "${stat}"`)
        }
      }
      for (const secretRef of collectSpecialRefs(choice.when, '#secret')) {
        const [characterId, secretId] = splitRef(secretRef)
        if (!story.characters?.[characterId]?.secrets?.[secretId]) {
          problems.push(`秘密条件引用了不存在的秘密 "${secretRef}"`)
        }
      }
    }
  }

  // 结局表孤儿条目
  for (const endId of Object.keys(story.endings)) {
    const used = Object.values(story.nodes).some((n) => n.ending?.id === endId)
    if (!used) {
      problems.push(`结局 "${endId}" 已登记但没有任何节点使用它`)
    }
  }

  // 不可达节点（忽略条件）
  const reachable = new Set<string>()
  const queue = [story.start]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (reachable.has(id)) continue
    reachable.add(id)
    const node = story.nodes[id]
    if (!node) continue
    for (const c of node.choices) queue.push(c.target)
  }
  for (const id of Object.keys(story.nodes)) {
    if (!reachable.has(id)) {
      problems.push(`节点 "${id}" 不可达（没有路径从起始节点指向它）`)
    }
  }

  // 条件 / 插值引用的未写入变量
  for (const node of Object.values(story.nodes)) {
    for (const choice of node.choices) {
      if (choice.when) {
        for (const ref of collectSpecialRefs(choice.when, '#evidence')) {
          if (!story.evidence?.[ref]) problems.push(`条件引用了不存在的证据 "${ref}"`)
        }
        for (const ref of collectSpecialRefs(choice.when, '#deduction')) {
          if (!story.deductions?.[ref]) problems.push(`条件引用了不存在的推论 "${ref}"`)
        }
        for (const v of collectConditionVars(choice.when)) {
          if (!writtenVars.has(v) && !writtenItems.has(v)) {
            problems.push(
              `节点 "${node.id}" 选项「${choice.label}」的条件引用了从未被写入的变量/道具 "${v}"`,
            )
          }
        }
      }
    }
    for (const m of node.text.matchAll(/\{([^}#]+)\}/g)) {
      const v = m[1].trim()
      if (!writtenVars.has(v)) {
        problems.push(`节点 "${node.id}" 的正文插值引用了从未被写入的变量 "{${v}}"`)
      }
    }
  }

  // 成就检查：id 唯一、字段完整、条件引用的变量被写入过
  const seenAch = new Set<string>()
  for (const ach of story.achievements ?? []) {
    if (!ach.id) problems.push('成就缺少 id')
    if (ach.id && seenAch.has(ach.id)) problems.push(`成就 id 重复："${ach.id}"`)
    if (ach.id) seenAch.add(ach.id)
    if (!ach.title) problems.push(`成就 "${ach.id ?? '?'}" 缺少 title`)
    if (!ach.description) problems.push(`成就 "${ach.id ?? '?'}" 缺少 description`)
    if (!ach.when) {
      problems.push(`成就 "${ach.id ?? '?'}" 缺少 when 达成条件`)
    } else {
      for (const v of collectConditionVars(ach.when)) {
        if (!writtenVars.has(v) && !writtenItems.has(v)) {
          problems.push(
            `成就 "${ach.id ?? '?'}" 的条件引用了从未被写入的变量/道具 "${v}"`,
          )
        }
      }
    }
  }

  return problems
}

/* ------------------------------ 辅助 ------------------------------ */

function collectEffects(
  effects: Effects | undefined,
  vars: Set<string>,
  items: Set<string>,
  docs?: Set<string>,
  evidence?: Set<string>,
): void {
  if (!effects) return
  for (const k of Object.keys(effects.set ?? {})) vars.add(k)
  for (const k of Object.keys(effects.add ?? {})) vars.add(k)
  for (const k of Object.keys(effects.flag ?? {})) vars.add(k)
  for (const item of effects.gain ?? []) items.add(item)
  for (const item of effects.lose ?? []) items.add(item)
  for (const d of effects.gainDocs ?? []) docs?.add(d)
  for (const id of effects.gainEvidence ?? []) evidence?.add(id)
  for (const r of effects.rand ?? []) vars.add(r.var)
}

function collectConditionVars(cond: Condition): string[] {
  const out: string[] = []
  if (cond.var && !cond.var.startsWith('#') && cond.op !== 'has' && cond.op !== 'not_has') {
    out.push(cond.var)
  }
  if (cond.var && !cond.var.startsWith('#') && (cond.op === 'has' || cond.op === 'not_has')) {
    out.push(cond.var)
  }
  for (const c of cond.and ?? []) out.push(...collectConditionVars(c))
  for (const c of cond.or ?? []) out.push(...collectConditionVars(c))
  if (cond.not) out.push(...collectConditionVars(cond.not))
  return out
}

function collectSpecialRefs(cond: Condition | undefined, specialVar: string): string[] {
  if (!cond) return []
  const out: string[] = []
  if (
    cond.var === specialVar &&
    (cond.op === 'eq' || cond.op === 'ne') &&
    cond.value !== undefined
  ) out.push(String(cond.value))
  for (const child of cond.and ?? []) out.push(...collectSpecialRefs(child, specialVar))
  for (const child of cond.or ?? []) out.push(...collectSpecialRefs(child, specialVar))
  if (cond.not) out.push(...collectSpecialRefs(cond.not, specialVar))
  return out
}

function collectRelationVars(cond: Condition | undefined): string[] {
  if (!cond) return []
  const out = cond.var?.startsWith('#relation:') ? [cond.var] : []
  for (const child of cond.and ?? []) out.push(...collectRelationVars(child))
  for (const child of cond.or ?? []) out.push(...collectRelationVars(child))
  if (cond.not) out.push(...collectRelationVars(cond.not))
  return out
}

function splitRef(ref: string): [string, string] {
  const index = ref.indexOf(':')
  return index < 0 ? ['', ''] : [ref.slice(0, index), ref.slice(index + 1)]
}
