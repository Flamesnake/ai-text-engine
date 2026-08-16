import type { Story } from '../core/types.js'
import type { EndingWitness, FailureWitness, WalkAction } from '../core/walk.js'
import { mountTextAdventure, type MountedTextAdventure, type MountOptions } from './runtime.js'

export interface DomWitnessReplayReport {
  endingId: string
  actions: number
  choices: number
  deductions: number
  puzzles: number
}

export interface DomFailureWitnessReplayReport {
  kind: FailureWitness['kind']
  nodeId: string
  actions: number
  choices: number
  deductions: number
  puzzles: number
}

type ReplayableWitness = EndingWitness | FailureWitness
type ActionReplayReport = Omit<DomWitnessReplayReport, 'endingId'>

export class DomWitnessReplayError extends Error {
  readonly endingId?: string
  readonly failureKind?: FailureWitness['kind']
  readonly actionIndex: number
  readonly action?: WalkAction
  readonly nodeId?: string
  readonly visibleChoices: string[]

  constructor(args: {
    witness: ReplayableWitness
    actionIndex: number
    action?: WalkAction
    root: HTMLElement
    reason: string
  }) {
    const nodeId = args.root.querySelector<HTMLElement>('[data-node-id]')?.dataset.nodeId
    const visibleChoices = [...args.root.querySelectorAll<HTMLElement>('[data-choice-label]')]
      .map((element) => element.dataset.choiceLabel ?? element.textContent?.trim() ?? '')
      .filter(Boolean)
    super(
      `DOM 见证重放失败：${witnessLabel(args.witness)}，动作 ${args.actionIndex + 1}/${args.witness.actions.length}` +
      `${nodeId ? `，节点 ${nodeId}` : ''}：${args.reason}` +
      `${visibleChoices.length > 0 ? `；可见选项：${visibleChoices.join(' / ')}` : ''}`,
    )
    this.name = 'DomWitnessReplayError'
    this.endingId = 'endingId' in args.witness ? args.witness.endingId : undefined
    this.failureKind = 'kind' in args.witness ? args.witness.kind : undefined
    this.actionIndex = args.actionIndex
    this.action = args.action
    this.nodeId = nodeId
    this.visibleChoices = visibleChoices
  }
}

/**
 * 把 walker 的状态层见证交给真实运行时 DOM 重放。
 * 它验证按钮、推理板、谜题输入、返回与重渲染；不评价文案、视觉节奏或提示质量。
 */
export function replayWitnessInDom(
  root: HTMLElement,
  story: Story,
  witness: EndingWitness,
  options?: MountOptions,
): DomWitnessReplayReport {
  prepareReplay(root, story, witness, options)
  const report = replayActionsInDom(root, story, witness)
  return finishEndingReplay(root, witness, report)
}

/** 与同步 API 等价，并在成功或失败后显式释放动画、音频与 DOM 资源。 */
export async function replayWitnessInDomAndDestroy(
  root: HTMLElement,
  story: Story,
  witness: EndingWitness,
  options?: MountOptions,
): Promise<DomWitnessReplayReport> {
  const mounted = prepareReplay(root, story, witness, options)
  try {
    return finishEndingReplay(root, witness, replayActionsInDom(root, story, witness))
  } finally {
    await mounted.destroy()
  }
}

function finishEndingReplay(
  root: HTMLElement,
  witness: EndingWitness,
  report: ActionReplayReport,
): DomWitnessReplayReport {
  const endingId = root.querySelector<HTMLElement>('[data-ending-id]')?.dataset.endingId
  if (endingId !== witness.endingId) {
    fail(root, witness, witness.actions.length, undefined, `重放结束于 ${endingId ?? '非结局页面'}`)
  }
  return { endingId: witness.endingId, ...report }
}

/** 重放失败路径，并确认页面确实停在无结局、无可推进动作的状态。 */
export function replayFailureWitnessInDom(
  root: HTMLElement,
  story: Story,
  witness: FailureWitness,
  options?: MountOptions,
): DomFailureWitnessReplayReport {
  prepareReplay(root, story, witness, options)
  return finishFailureReplay(root, witness, replayActionsInDom(root, story, witness))
}

/** 失败路径的自动清理版本，供批量 happy-dom 验收脚本使用。 */
export async function replayFailureWitnessInDomAndDestroy(
  root: HTMLElement,
  story: Story,
  witness: FailureWitness,
  options?: MountOptions,
): Promise<DomFailureWitnessReplayReport> {
  const mounted = prepareReplay(root, story, witness, options)
  try {
    return finishFailureReplay(root, witness, replayActionsInDom(root, story, witness))
  } finally {
    await mounted.destroy()
  }
}

function finishFailureReplay(
  root: HTMLElement,
  witness: FailureWitness,
  report: ActionReplayReport,
): DomFailureWitnessReplayReport {
  const nodeId = root.querySelector<HTMLElement>('[data-node-id]')?.dataset.nodeId
  if (nodeId !== witness.nodeId) {
    fail(root, witness, witness.actions.length, undefined, `重放结束于节点 ${nodeId ?? '未知'}，预期 ${witness.nodeId}`)
  }
  if (root.querySelector('[data-ending-id]')) {
    fail(root, witness, witness.actions.length, undefined, '失败路径意外抵达结局')
  }
  const choices = root.querySelectorAll('[data-choice-target]').length
  const puzzles = root.querySelectorAll('[data-puzzle-choice]').length
  if (root.querySelector('[data-action="handbook"]') || root.querySelector('[data-action="open-evidence"]')) {
    openEvidenceBoardForReplay(root, witness, witness.actions.length, undefined)
    const confirmable = [...root.querySelectorAll<HTMLElement>('[data-deduction-can-confirm="true"]')]
      .some((element) => !element.classList.contains('deduction-confirmed'))
    if (confirmable) {
      fail(root, witness, witness.actions.length, undefined, '页面仍存在可以确认并推进状态的推论')
    }
    const close = root.querySelector<HTMLElement>('[data-action="handbook-close"]')
    if (!close) fail(root, witness, witness.actions.length, undefined, '检查推理板后找不到关闭按钮')
    close.click()
  }
  if (choices > 0 || puzzles > 0) {
    fail(root, witness, witness.actions.length, undefined, '页面仍存在可推进的选项、谜题或推理行动')
  }
  return { kind: witness.kind, nodeId: witness.nodeId, ...report }
}

function prepareReplay(
  root: HTMLElement,
  story: Story,
  witness: ReplayableWitness,
  options?: MountOptions,
): MountedTextAdventure {
  const storage = options?.storage ?? window.localStorage
  const saveKey = options?.saveKey ?? `ate:witness:${story.meta.title}:${witnessLabel(witness)}`
  storage.removeItem(saveKey)
  const mounted = mountTextAdventure(root, story, { storage, saveKey })

  const start = root.querySelector<HTMLElement>('[data-action="start"]')
  if (!start) fail(root, witness, -1, undefined, '找不到开始游戏按钮')
  start.click()
  dismissStageCutscene(root)
  return mounted
}

function replayActionsInDom(
  root: HTMLElement,
  story: Story,
  witness: ReplayableWitness,
): ActionReplayReport {
  const report: ActionReplayReport = {
    actions: witness.actions.length,
    choices: 0,
    deductions: 0,
    puzzles: 0,
  }

  for (let actionIndex = 0; actionIndex < witness.actions.length; actionIndex++) {
    const action = witness.actions[actionIndex]
    const nodeId = root.querySelector<HTMLElement>('[data-node-id]')?.dataset.nodeId
    if (nodeId !== action.nodeId) {
      fail(root, witness, actionIndex, action, `当前节点 ${nodeId ?? '未知'} 与动作节点 ${action.nodeId} 不一致`)
    }

    if (action.type === 'deduction') {
      replayDeduction(root, witness, actionIndex, action)
      report.deductions++
      dismissStageCutscene(root)
      continue
    }
    if (action.type === 'puzzle') {
      replayPuzzle(root, story, witness, actionIndex, action)
      report.puzzles++
      dismissStageCutscene(root)
      continue
    }
    replayChoice(root, witness, actionIndex, action)
    report.choices++
    dismissStageCutscene(root)
  }

  return report
}

/** 舞台过场会遮住正文与选项，重放时点击推进并移除过场层。 */
function dismissStageCutscene(root: HTMLElement): void {
  const overlay = root.querySelector<HTMLElement>('.stage-cutscene')
  if (!overlay) return
  overlay.querySelector<HTMLElement>('[data-action="stage-advance"]')?.click()
  root.querySelector('.stage-cutscene')?.remove()
}

function replayChoice(
  root: HTMLElement,
  witness: ReplayableWitness,
  actionIndex: number,
  action: Extract<WalkAction, { type: 'choice' }>,
): void {
  const button = [...root.querySelectorAll<HTMLElement>('[data-choice-target]')].find(
    (element) => element.dataset.choiceTarget === action.target && element.dataset.choiceLabel === action.label,
  )
  if (!button) fail(root, witness, actionIndex, action, `找不到选项 ${action.label} -> ${action.target}`)
  button.click()
}

function replayDeduction(
  root: HTMLElement,
  witness: ReplayableWitness,
  actionIndex: number,
  action: Extract<WalkAction, { type: 'deduction' }>,
): void {
  openEvidenceBoardForReplay(root, witness, actionIndex, action)

  const radio = [...root.querySelectorAll<HTMLInputElement>('input[name="deduction"]')]
    .find((input) => input.value === action.deductionId)
  if (!radio || radio.disabled) fail(root, witness, actionIndex, action, `推论 ${action.deductionId} 不可选择`)
  radio.click()

  for (const evidenceId of action.evidence) {
    const evidence = [...root.querySelectorAll<HTMLInputElement>('[data-evidence]')]
      .find((input) => input.value === evidenceId)
    if (!evidence) fail(root, witness, actionIndex, action, `证据 ${evidenceId} 不在推理板中`)
    if (!evidence.checked) evidence.click()
  }

  const confirm = root.querySelector<HTMLElement>('[data-action="confirm-deduction"]')
  if (!confirm) fail(root, witness, actionIndex, action, '找不到验证推论按钮')
  confirm.click()
  const confirmed = [...root.querySelectorAll<HTMLElement>('[data-deduction]')]
    .find((element) => element.dataset.deduction === action.deductionId)
  if (!confirmed?.classList.contains('deduction-confirmed')) {
    fail(root, witness, actionIndex, action, `推论 ${action.deductionId} 未成立`)
  }
  const close = root.querySelector<HTMLElement>('[data-action="handbook-close"]')
  if (!close) fail(root, witness, actionIndex, action, '推论成立后找不到关闭按钮')
  close.click()
}

/** 打开推理板：优先新证据提示里的直达按钮，否则通过悬浮手册进入推理板。 */
function openEvidenceBoardForReplay(
  root: HTMLElement,
  witness: ReplayableWitness,
  actionIndex: number,
  action: WalkAction | undefined,
): void {
  const direct = root.querySelector<HTMLElement>('[data-action="open-evidence"]')
  if (direct) {
    direct.click()
    return
  }
  const handbook = root.querySelector<HTMLElement>('[data-action="handbook"]')
  if (!handbook) fail(root, witness, actionIndex, action, '找不到调查手册入口以打开推理板')
  handbook.click()
  const evidenceEntry = root.querySelector<HTMLElement>('[data-handbook-entry="evidence"]')
  if (!evidenceEntry) fail(root, witness, actionIndex, action, '手册中没有推理板入口')
  evidenceEntry.click()
}

function replayPuzzle(
  root: HTMLElement,
  story: Story,
  witness: ReplayableWitness,
  actionIndex: number,
  action: Extract<WalkAction, { type: 'puzzle' }>,
): void {
  const entry = [...root.querySelectorAll<HTMLElement>('[data-puzzle-choice]')]
    .find((element) => element.dataset.puzzleChoice === action.puzzleId)
  if (!entry) fail(root, witness, actionIndex, action, `找不到谜题入口 ${action.puzzleId}`)
  entry.click()

  const input = [...root.querySelectorAll<HTMLInputElement>('[data-puzzle-answer]')]
    .find((element) => element.dataset.puzzleAnswer === action.puzzleId)
  const solution = story.puzzles?.[action.puzzleId]?.solution
  if (!input || solution === undefined) fail(root, witness, actionIndex, action, `谜题 ${action.puzzleId} 缺少输入框或答案`)
  input.value = solution
  const submit = root.querySelector<HTMLElement>('[data-action="attempt-puzzle"]')
  if (!submit) fail(root, witness, actionIndex, action, '找不到提交谜题按钮')
  submit.click()
  if (!root.querySelector('.puzzle-solved')) fail(root, witness, actionIndex, action, `谜题 ${action.puzzleId} 未解开`)
  const back = root.querySelector<HTMLElement>('[data-action="back"]')
  if (!back) fail(root, witness, actionIndex, action, '谜题解开后找不到返回按钮')
  back.click()
}

function fail(
  root: HTMLElement,
  witness: ReplayableWitness,
  actionIndex: number,
  action: WalkAction | undefined,
  reason: string,
): never {
  throw new DomWitnessReplayError({ root, witness, actionIndex, action, reason })
}

function witnessLabel(witness: ReplayableWitness): string {
  return 'endingId' in witness
    ? `结局 ${witness.endingId}`
    : `失败 ${witness.kind}@${witness.nodeId}`
}
