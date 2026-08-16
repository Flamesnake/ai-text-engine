/**
 * 受控舞台（P2-2 拆分）：舞台 cue 恢复、CSS 回退渲染与 WebGL 过场打开/退场。
 * 共享可变状态（活动 3D 句柄、退场定时器）集中在 stageState 由宿主持有并传入。
 */
import { createStage3d, type Stage3dHandle } from '../stage3d.js'
import type { StageCue, Story, StoryNode } from '../../core/types.js'

/** 由访问序列重建最近舞台；cue 按字段合并，actors 数组整体替换，clear 撤台。 */
export function resolveStageForHistory(story: Story, history: readonly string[]): StageCue | null {
  let current: StageCue | null = null
  for (const [index, nodeId] of history.entries()) {
    if (index > 0 && current) {
      const previous: StageCue = current
      current = {
        ...previous,
        ...(previous.camera === 'push' ? { camera: 'close' as const } : {}),
        ...(previous.actors ? {
          actors: previous.actors.map(({ entrance: _entrance, ...actor }) => actor),
        } : {}),
      }
    }
    const cue = story.nodes[nodeId]?.stage
    if (cue === 'clear') {
      current = null
    } else if (cue) {
      current = {
        ...(current ?? {}),
        ...cue,
        ...(cue.actors !== undefined ? { actors: cue.actors } : {}),
      }
    }
  }
  return current
}

/** 舞台无障碍文案（P1-4）：布景/灯光/在台角色，CSS 回退与 WebGL 路径共用。 */
export function stageAriaLabel(story: Story, stage: StageCue): string {
  const backdrop = stage.backdrop ?? 'neutral'
  const lighting = stage.lighting ?? 'natural'
  const actorNames = (stage.actors ?? []).map(
    (actor) => story.characters?.[actor.characterId]?.name ?? actor.characterId,
  )
  return [`${backdrop} 布景`, `${lighting} 灯光`, ...actorNames].join('，')
}

/** 舞台域的共享可变状态（宿主持有：runtime.ts 闭包内的两个 let）。 */
export interface StageMutableState {
  activeStage3d: Stage3dHandle | null
  stageCutsceneTimer: ReturnType<typeof setTimeout> | null
}

export interface StageCtx {
  story: Story
  root: HTMLElement
  /** 当前访问历史（用于恢复舞台 cue 与声画），延迟求值避免初始化顺序问题。 */
  history: () => readonly string[]
  /** CSS 回退舞台的完整 HTML（宿主负责组装角色/站位信息）。 */
  renderStageHtml: () => string
  state: StageMutableState
}

export function clearStageCutscene(ctx: StageCtx): void {
  const { state } = ctx
  if (state.stageCutsceneTimer !== null) {
    clearTimeout(state.stageCutsceneTimer)
    state.stageCutsceneTimer = null
  }
  state.activeStage3d?.dispose()
  state.activeStage3d = null
  ctx.root.querySelector('.stage-cutscene')?.remove()
}

/** 只有带过场标签或演员的舞台才是“舞台时刻”，普通节点不再常驻舞台块。 */
export function isStageMoment(node: StoryNode): boolean {
  if (!node.stage || node.stage === 'clear') return false
  return Boolean(
    node.tags?.includes('cutscene') ||
    node.tags?.includes('setpiece') ||
    (node.stage.actors?.length ?? 0) > 0,
  )
}

/** 舞台过场：WebGL 可用时使用卡门式低分辨率 3D 小舞台，否则回退到 CSS 舞台。 */
export function openStageCutscene(ctx: StageCtx): void {
  const reducedMotion = typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reducedMotion) return

  const { story, root, state } = ctx
  const stage = resolveStageForHistory(story, ctx.history())
  const stage3d = stage ? createStage3d(stage, (stage.actors ?? []).map((actor) => {
    const character = story.characters?.[actor.characterId]
    const name = character?.name ?? actor.characterId
    return {
      name,
      initial: Array.from(name.trim())[0] ?? '·',
      position: actor.position,
      pose: actor.pose ?? 'neutral',
      focus: actor.focus ?? false,
      entrance: actor.entrance ?? 'none',
    }
  })) : null

  const overlay = document.createElement('div')
  overlay.className = 'stage-cutscene'
  if (stage3d) {
    state.activeStage3d = stage3d
    // 无障碍语义：裸 <canvas> 屏幕阅读器读不到场景，与 CSS 回退舞台同文案（P1-4）
    stage3d.canvas.setAttribute('role', 'img')
    stage3d.canvas.setAttribute('aria-label', stageAriaLabel(story, stage!))
    const frame = document.createElement('div')
    frame.className = 'stage3d-frame'
    frame.appendChild(stage3d.canvas)
    const lcd = document.createElement('div')
    lcd.className = 'stage3d-lcd'
    const glass = document.createElement('div')
    glass.className = 'stage3d-glass'
    frame.appendChild(lcd)
    frame.appendChild(glass)
    overlay.innerHTML = `<div class="stage-cutscene-inner">
      <div class="stage3d-wrap"></div>
      <button class="stage-continue" data-action="stage-advance">点击继续 · Enter</button>
    </div>`
    overlay.querySelector('.stage3d-wrap')!.appendChild(frame)
  } else {
    overlay.innerHTML = `<div class="stage-cutscene-inner">
      ${ctx.renderStageHtml()}
      <button class="stage-continue" data-action="stage-advance">点击继续 · Enter</button>
    </div>`
  }
  root.appendChild(overlay)

  overlay.querySelector('[data-action="stage-advance"]')!.addEventListener('click', () => {
    if (state.stageCutsceneTimer !== null) {
      clearTimeout(state.stageCutsceneTimer)
      state.stageCutsceneTimer = null
    }
    overlay.classList.add('stage-cutscene-exit')
    state.stageCutsceneTimer = setTimeout(() => {
      overlay.remove()
      state.activeStage3d?.dispose()
      state.activeStage3d = null
    }, 420)
  })
  state.stageCutsceneTimer = setTimeout(() => {
    overlay.querySelector('.stage-continue')?.classList.add('ready')
  }, 900)
}

/** CSS 回退舞台的完整 HTML（含无障碍文案；WebGL 不可用时展示）。 */
export function renderStage(ctx: StageCtx): string {
  const stage = resolveStageForHistory(ctx.story, ctx.history())
  if (!stage) return ''
  const backdrop = stage.backdrop ?? 'neutral'
  const lighting = stage.lighting ?? 'natural'
  const camera = stage.camera ?? 'medium'
  return `<section class="stage-scene stage-backdrop-${backdrop} stage-light-${lighting} stage-camera-${camera}" data-stage="true" data-backdrop="${backdrop}" data-lighting="${lighting}" data-camera="${camera}" role="img" aria-label="${esc(stageAriaLabel(ctx.story, stage))}">
    <div class="stage-set" aria-hidden="true"></div>
    <div class="stage-actors">
      ${(stage.actors ?? []).map((actor) => {
        const character = ctx.story.characters?.[actor.characterId]
        const name = character?.name ?? actor.characterId
        const initial = Array.from(name.trim())[0] ?? '·'
        const pose = actor.pose ?? 'neutral'
        const entrance = actor.entrance ?? 'none'
        return `<figure class="stage-actor stage-pos-${actor.position} stage-pose-${pose} stage-enter-${entrance}${actor.focus ? ' stage-focus' : ''}" data-stage-actor="${esc(actor.characterId)}" data-position="${actor.position}" data-pose="${pose}"${actor.focus ? ' data-focus="true"' : ''}>
          <div class="stage-actor-figure"><span>${esc(initial)}</span></div>
          <figcaption>${esc(name)}</figcaption>
        </figure>`
      }).join('')}
    </div>
  </section>`
}

const esc = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')