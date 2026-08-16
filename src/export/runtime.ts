import { Game } from '../core/engine.js'
import type { EndingMeta, FxSpec, GameState, PresentationConfig, SoundscapeSpec, StateAppearance, Story, StoryNode, TextBlock, TextSegment, ThemeConfig } from '../core/types.js'
import { disposeSfx, initSfx, isMuted, playSfx, setSoundscape, toggleMuted, type SfxName } from './sfx.js'
import { resolveTheme } from './themes.js'
import { TypewriterController } from './runtime/typewriter.js'
import { HandbookController } from './runtime/handbook.js'
import {
  clearStageCutscene,
  isStageMoment,
  openStageCutscene,
  renderStage,
  type StageMutableState,
} from './runtime/stage.js'

// P2-2 拆分后舞台 cue 恢复与无障碍文案位于 runtime/stage.js；公开 API 保持原导出点不变。
export { resolveStageForHistory, stageAriaLabel } from './runtime/stage.js'
import {
  renderChoiceButtons,
  renderGameHeader,
  renderPageHeader,
  siteArchiveLabel,
  siteClearLabel,
  siteContinueLabel,
  siteDefaultLayout,
  siteStartLabel,
  siteTitleBadge,
  type SiteRenderCtx,
} from './runtime/site.js'

/**
 * 运行时渲染器：内嵌于导出的单文件 HTML 中（经 esbuild bundle 成 IIFE）。
 * 负责标题屏 → 正文卡片 → 选项 → 结局的完整游玩界面与 localStorage 存档。
 * 不依赖任何外部资源。
 */

export interface MountOptions {
  /** 存档 key（默认按标题生成） */
  saveKey?: string
  /** 存储后端（默认 window.localStorage；测试可注入） */
  storage?: Storage
}

export interface MountedTextAdventure {
  /** 清理持续动画、页面内容与共享 AudioContext。 */
  destroy(): Promise<void>
}

/** 由存档访问序列重建最近一次持续声景，供恢复存档与运行时测试共用。 */
export function resolveSoundscapeForHistory(
  story: Story,
  history: readonly string[],
  world?: string,
  phase?: string,
): SoundscapeSpec | null {
  let current = story.meta.soundscape ?? null
  for (const nodeId of history) {
    const declared = story.nodes[nodeId]?.soundscape
    if (declared === 'silence') current = null
    else if (declared) current = declared
  }
  const applyState = (appearance: StateAppearance | undefined): void => {
    if (appearance?.soundscape === 'silence') current = null
    else if (appearance?.soundscape) current = appearance.soundscape
  }
  applyState(world ? story.meta.world?.states[world] : undefined)
  applyState(phase ? story.meta.phase?.states[phase] : undefined)
  const currentNodeSoundscape = story.nodes[history.at(-1) ?? '']?.soundscape
  if (currentNodeSoundscape === 'silence') current = null
  else if (currentNodeSoundscape) current = currentNodeSoundscape
  return current
}

/** 由访问序列重建最近舞台；cue 按字段合并，actors 数组整体替换，clear 撤台。 */
export function mountTextAdventure(root: HTMLElement, story: Story, options?: MountOptions): MountedTextAdventure {
  const storage = options?.storage ?? window.localStorage
  // 存档 key 优先用作品稳定 uid，避免 file:// 下同标题/改名作品互相覆盖；旧作品无 uid 时回退标题 key。
  const saveKey = options?.saveKey ?? (story.meta.uid ? `ate:${story.meta.uid}` : `ate:${story.meta.title}`)
  let game: Game
  /** 上次渲染时的成就快照（用于检测新解锁弹 toast） */
  let lastAchievements: string[] = []
  /** 上次场景渲染时已拥有的证据，用于只提示本次新增项。 */
  let lastEvidence: string[] = []
  /** 不稳定灯随机爆发定时器 */
  let unstableTimer: ReturnType<typeof setTimeout> | null = null
  let lastRenderedStateKey: string | null = null
  /** 最近一次渲染的节点 id：同节点重绘（关手册等）不重播舞台过场。 */
  let lastRenderedNodeId: string | null = null
  /** 舞台过场共享状态（P2-2：传给 runtime/stage.ts，由模块读写）。 */
  const stageState: StageMutableState = { activeStage3d: null, stageCutsceneTimer: null }
  /** 逐字输出控制器（P2-2：独立模块持有活动元素与定时器）。 */
  const typewriter = new TypewriterController()

  /** 拟态网站渲染上下文（P2-2：site 模块显式传递；game 由 getter 延迟求值）。 */
  /** 调查手册控制器（P2-2：独立模块持有刷新标记与已揭示提示）。 */
  const handbook = new HandbookController({
    story,
    root,
    game: () => game,
    esc,
    cssEscape,
    playSfx,
    save,
    refreshStory: () => renderNode(),
    bindIn,
  })

  /** 舞台渲染上下文（P2-2：stage 模块显式传递）。 */
  const stageCtx = {
    story,
    root,
    history: () => game.state.history,
    renderStageHtml: () => renderStage(stageCtx),
    state: stageState,
  } as const

  /** 拟态网站渲染上下文（P2-2：site 模块显式传递；game 由 getter 延迟求值）。 */
  const siteCtx: SiteRenderCtx = {
    story,
    get game() {
      return game
    },
    esc,
    muteButtonHtml,
  }

  initSfx()

  /* ------------------------------ 存档 ------------------------------ */

  function save(): void {
    try {
      storage.setItem(saveKey, JSON.stringify(game.toSave()))
    } catch {
      /* 隐私模式等场景静默失败 */
    }
  }

  function load(): GameState | null {
    try {
      const raw = storage.getItem(saveKey)
      if (!raw) return null
      const parsed = JSON.parse(raw) as GameState
      if (typeof parsed?.nodeId !== 'string' || !Array.isArray(parsed.history)) return null
      return parsed
    } catch {
      return null
    }
  }

  function hasSave(): boolean {
    return load() !== null
  }

  /* ------------------------------ 渲染 ------------------------------ */

  /** 静音开关按钮（标题屏与游戏画面共用） */
  function muteButtonHtml(): string {
    return `<button class="btn btn-ghost docs-btn" data-action="mute" title="音效开关">${
      isMuted() ? '🔇' : '🔊'
    }</button>`
  }

  function bindMute(): void {
    root.querySelector('[data-action="mute"]')?.addEventListener('click', () => {
      toggleMuted()
      const btn = root.querySelector<HTMLElement>('[data-action="mute"]')
      if (btn) btn.textContent = isMuted() ? '🔇' : '🔊'
    })
  }

  /** 节点卡片动画：返回 class 与内联 CSS 变量（幅度/频率由 FxSpec 控制） */
  function cardFx(node: StoryNode): {
    cls: string
    style: string
    unstable: { intensity: number; speed: number } | null
  } {
    const cls: string[] = []
    const vars: string[] = []
    let unstable: { intensity: number; speed: number } | null = null
    for (const item of node.fx ?? []) {
      const spec: FxSpec = typeof item === 'string' ? { name: item } : item
      cls.push(`fx-${spec.name}`)
      const intensity = spec.intensity ?? 1
      const speed = Math.max(0.1, spec.speed ?? 1)
      const dur = (base: number) => `${(base / speed).toFixed(3)}s`
      switch (spec.name) {
        case 'shake':
          vars.push(`--fx-shake-amp: ${(3 * intensity).toFixed(1)}px`)
          vars.push(`--fx-shake-dur: ${dur(0.45)}`)
          break
        case 'flicker':
          // intensity=1 最低亮度 0.35；越大越暗（剧烈），越小越接近 1（轻微闪烁）
          vars.push(`--fx-flicker-min: ${Math.max(0.05, 1 - 0.65 * intensity).toFixed(2)}`)
          vars.push(`--fx-flicker-dur: ${dur(1.3)}`)
          break
        case 'unstable':
          // 不稳定灯：随机间隔连闪爆发（JS 驱动）；intensity 控制闪到多暗，speed 控制爆发频率
          vars.push(`--fx-burst-min: ${Math.max(0.05, 1 - 0.8 * intensity).toFixed(2)}`)
          unstable = { intensity, speed }
          break
        case 'glitch':
          vars.push(`--fx-glitch-amp: ${(2 * intensity).toFixed(1)}px`)
          vars.push(`--fx-glitch-dur: ${dur(0.5)}`)
          break
        case 'pulse':
          vars.push(`--fx-pulse-scale: ${(1 + 0.02 * intensity).toFixed(3)}`)
          vars.push(`--fx-pulse-dur: ${dur(1.4)}`)
          break
        case 'spotlight': {
          // intensity 控制四周压暗深度（越强对比越明显）；speed 控制摇晃/闪烁周期。
          const dim = Math.min(0.6, Math.max(0.15, 0.4 * intensity)).toFixed(2)
          vars.push(`--fx-spotlight-dim: ${dim}`)
          vars.push(`--fx-spotlight-sway-dur: ${dur(3.4)}`)
          vars.push(`--fx-spotlight-flicker-dur: ${dur(1.1)}`)
          if (spec.sway) cls.push('fx-spotlight-sway')
          if (spec.flicker) cls.push('fx-spotlight-flicker')
          break
        }
      }
    }
    return { cls: cls.join(' '), style: vars.join('; '), unstable }
  }

  /** 不稳定灯：清除进行中的随机爆发定时器 */
  function clearUnstable(): void {
    if (unstableTimer !== null) {
      clearTimeout(unstableTimer)
      unstableTimer = null
    }
  }

  /**
   * 不稳定灯驱动：大部分时间正常 → 随机间隔（2-5 秒 / speed）触发一次「连闪爆发」。
   * 爆发 = 给卡片加 .fx-burst（单次 0.55s 动画，连续闪 3 次）后移除，再进入下一轮随机等待。
   */
  function startUnstable(
    card: HTMLElement,
    spec: { intensity: number; speed: number },
  ): void {
    clearUnstable()
    const schedule = (): void => {
      const delay = ((2000 + Math.random() * 3000) / spec.speed) | 0
      unstableTimer = setTimeout(() => {
        card.classList.add('fx-burst')
        setTimeout(() => card.classList.remove('fx-burst'), 580)
        schedule()
      }, delay)
    }
    schedule()
  }

  /** 播放经过 Schema 验证的节点音效。 */
  function playNodeSfx(node: StoryNode): void {
    if (node.sfx) playSfx(node.sfx)
  }

  /**
   * 从实际访问历史恢复最近一次声景切换；未声明的节点沿用，避免重复配置。
   * 新游戏从 meta.soundscape 开始，节点 silence 显式覆盖为寂静。
   */
  function resolveSoundscape(): SoundscapeSpec | null {
    return resolveSoundscapeForHistory(story, game.state.history, game.state.world, game.state.phase)
  }

  function stateAppearance(axis: 'world' | 'phase', id: string | undefined): StateAppearance | undefined {
    return id ? story.meta[axis]?.states[id] : undefined
  }

  function currentState(): GameState | undefined {
    return typeof game === 'undefined' ? undefined : game.state
  }

  function currentAppearances(): StateAppearance[] {
    const state = currentState()
    if (!state) return []
    return [stateAppearance('world', state.world), stateAppearance('phase', state.phase)]
      .filter((item): item is StateAppearance => Boolean(item))
  }

  function effectiveTheme(): string | ThemeConfig | undefined {
    let theme = story.meta.theme
    for (const appearance of currentAppearances()) {
      if (appearance.theme !== undefined) theme = appearance.theme
    }
    return theme
  }

  function applyTheme(useState = true): void {
    const resolved = resolveTheme(useState ? effectiveTheme() : story.meta.theme)
    const c = resolved.colors
    const style = document.documentElement.style
    style.setProperty('--scheme', resolved.scheme)
    style.setProperty('--bg', c.background)
    style.setProperty('--card', c.card)
    style.setProperty('--border', c.border)
    style.setProperty('--border-glow', c.borderGlow)
    style.setProperty('--text', c.text)
    style.setProperty('--text-dim', c.textDim)
    style.setProperty('--accent', c.accent)
    style.setProperty('--danger', c.danger)
    style.setProperty('--gold', c.gold)
    style.setProperty('--green', c.green)
    style.setProperty('--purple', c.purple)
    style.colorScheme = resolved.scheme
  }

  const presentationDefaults: Required<PresentationConfig> = {
    shell: 'novel',
    typography: 'literary',
    density: 'balanced',
    shape: 'soft',
    choiceStyle: 'buttons',
    choiceReveal: 'fade',
    textReveal: 'instant',
  }

  /** 全局只定义一次，节点仅覆盖差异项；返回合并后的有效视觉配置。 */
  function effectivePresentation(node?: StoryNode): Required<PresentationConfig> {
    const statePresentation = currentAppearances().reduce<PresentationConfig>(
      (merged, appearance) => ({ ...merged, ...(appearance.presentation ?? {}) }),
      {},
    )
    return {
      ...presentationDefaults,
      ...(story.meta.presentation ?? {}),
      ...statePresentation,
      ...(node?.presentation ?? {}),
    }
  }

  /** 稳定 class 供 CSS 外壳组合。 */
  function presentationClasses(node?: StoryNode): string {
    const p = effectivePresentation(node)
    return [
      `shell-${p.shell}`,
      `type-${p.typography}`,
      `density-${p.density}`,
      `shape-${p.shape}`,
      `choice-${p.choiceStyle}`,
      `choice-reveal-${p.choiceReveal}`,
      `text-reveal-${p.textReveal}`,
      story.meta.site ? `site-${story.meta.site.kind}` : '',
      story.meta.site?.persona ? `site-${story.meta.site.kind}-${story.meta.site.persona}` : '',
    ].join(' ')
  }

  function renderTitle(): void {
    clearUnstable()
    typewriter.clear()
    clearStageCutscene(stageCtx)
    lastRenderedNodeId = null
    setSoundscape(null)
    applyTheme(false)
    lastRenderedStateKey = null
    const has = hasSave()
    const achCount = (story.achievements ?? []).length
    const site = story.meta.site
    root.innerHTML = `
      <main class="screen title-screen ${presentationClasses()}">
        <div class="title-badge">${siteTitleBadge(story)}</div>
        <h1 class="title-main">${esc(site?.name ?? story.meta.title)}</h1>
        ${(site?.tagline ?? story.meta.subtitle) ? `<p class="title-sub">${esc(site?.tagline ?? story.meta.subtitle ?? '')}</p>` : ''}
        <div class="title-actions">
          <button class="btn btn-primary" data-action="start">${siteStartLabel(story)}</button>
          ${has ? `<button class="btn" data-action="continue">${siteContinueLabel(story)}</button>` : ''}
          ${has ? `<button class="btn btn-ghost" data-action="clear">${siteClearLabel(story)}</button>` : ''}
          ${achCount > 0 ? `<button class="btn btn-ghost" data-action="achievements">${siteArchiveLabel(story)}</button>` : ''}
        </div>
        <p class="title-foot">${muteButtonHtml()}</p>
      </main>`
    bind('[data-action="start"]', () => {
      game = new Game(story)
      lastAchievements = [...game.state.achievements]
      lastEvidence = []
      handbook.resetState()
      lastRenderedNodeId = null
      save()
      renderNode()
    })
    bind('[data-action="continue"]', () => {
      game = new Game(story, load())
      lastAchievements = [...game.state.achievements]
      lastEvidence = [...game.state.evidence]
      handbook.resetState()
      lastRenderedNodeId = null
      renderNode()
    })
    bind('[data-action="clear"]', () => {
      try {
        storage.removeItem(saveKey)
      } catch {
        /* noop */
      }
      renderTitle()
    })
    bind('[data-action="achievements"]', () => renderAchievements())
    bindMute()
  }

  /** 成就列表画面 */
  function renderAchievements(): void {
    clearUnstable()
    typewriter.clear()
    const achievements = story.achievements ?? []
    const unlocked = load()?.achievements ?? []
    const siteMode = Boolean(story.meta.site)
    root.innerHTML = `
      <main class="screen title-screen achievements-screen ${presentationClasses()}">
        <div class="title-badge">${siteMode ? 'ARCHIVE' : 'ACHIEVEMENTS'}</div>
        <h2 class="ach-heading">${siteArchiveLabel(story)}</h2>
        <p class="ach-count">${siteMode ? '已发现' : '已解锁'} ${unlocked.length} / ${achievements.length}</p>
        <div class="ach-list">
          ${achievements
            .map((ach) => {
              const isUnlocked = unlocked.includes(ach.id)
              const reveal = isUnlocked || !ach.hidden
              return `<div class="ach-item ${isUnlocked ? 'ach-unlocked' : 'ach-locked'}">
                <span class="ach-icon">${isUnlocked ? esc(ach.icon ?? '🏆') : '🔒'}</span>
                <div class="ach-body">
                  <div class="ach-title">${esc(reveal ? ach.title : '？？？')}</div>
                  <div class="ach-desc">${esc(reveal ? ach.description : '达成条件未知')}</div>
                </div>
              </div>`
            })
            .join('')}
        </div>
        <div class="title-actions">
          <button class="btn" data-action="back">${siteMode ? '返回首页' : '返回'}</button>
        </div>
      </main>`
    bind('[data-action="back"]', () => renderTitle())
  }

  /** 检测新解锁成就并弹 toast */
  function notifyNewAchievements(): void {
    const unlocked = game.state.achievements
    const newly = unlocked.filter((id) => !lastAchievements.includes(id))
    lastAchievements = [...unlocked]
    if (newly.length === 0) return
    const items = newly
      .map((id) => story.achievements?.find((a) => a.id === id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
    const toast = document.createElement('div')
    toast.className = 'achievement-toast'
    toast.innerHTML = items
      .map((a) => `<div class="ach-toast-item">${esc(a.icon ?? '🏆')} ${story.meta.site ? '发现档案' : '成就解锁'}：${esc(a.title)}</div>`)
      .join('')
    root.appendChild(toast)
    playSfx('achievement')
    setTimeout(() => toast.remove(), 3200)
  }

  function renderNode(): void {
    save()
    typewriter.clear()
    clearStageCutscene(stageCtx)
    const node = game.currentNode
    const step = game.stepCount
    const stageMoment = isStageMoment(node)
    const showStageCutscene = stageMoment && node.id !== lastRenderedNodeId
    const presentation = effectivePresentation(node)
    applyTheme()
    setSoundscape(resolveSoundscape())
    const stateKey = `${game.state.world}\u0000${game.state.phase}`
    const transitionClass = lastRenderedStateKey !== null && lastRenderedStateKey !== stateKey
      ? 'state-transition'
      : ''
    lastRenderedStateKey = stateKey
    if (game.isEnding && node.ending) {
      renderEnding(node.ending, step, transitionClass)
      return
    }
    const choices = game.visibleChoices()
    const scenePuzzles = game.availablePuzzles()
    const newEvidence = game.state.evidence.filter((id) => !lastEvidence.includes(id))
    lastEvidence = [...game.state.evidence]
    const handbookAttention = scenePuzzles.length > 0 || newEvidence.length > 0
    const tutorial = handbook.activeTutorial(scenePuzzles.length > 0)
    playNodeSfx(node)
    const fx = cardFx(node)
    root.innerHTML = `
      <main class="screen game-screen ${presentationClasses(node)} ${transitionClass}" data-node-id="${esc(node.id)}" data-world="${esc(game.state.world)}" data-phase="${esc(game.state.phase)}"${story.meta.site ? ` data-site-kind="${story.meta.site.kind}" data-page-layout="${node.page?.layout ?? siteDefaultLayout(story.meta.site.kind)}"${node.page?.composition ? ` data-page-composition="${node.page.composition}"` : ''}` : ''}>
        ${renderGameHeader(siteCtx, step)}
        ${handbook.fabHtml(handbookAttention)}
        ${node.objective ? `<aside class="scene-objective"><strong>当前目标</strong><span>${esc(game.interpolate(node.objective))}</span></aside>` : ''}
        ${newEvidence.length > 0 ? `<aside class="evidence-notice"><strong>新证据</strong><span>${newEvidence.map((id) => esc(story.evidence?.[id]?.title ?? id)).join('、')}已加入推理板。</span><button class="btn btn-ghost docs-btn" data-action="open-evidence">整理线索并推理</button></aside>` : ''}
        ${tutorial ? handbook.tutorialBanner(tutorial) : ''}
        <section class="card ${fx.cls}" style="${fx.style}">
          ${renderPageHeader(siteCtx, node)}
          ${renderChoiceResponse()}
          ${renderBody(node, presentation.textReveal)}
          <div class="card-actions">
            ${scenePuzzles
              .map(
                (puzzle) =>
                  `<button class="btn btn-primary puzzle-choice" data-puzzle-choice="${esc(puzzle.id)}">${esc(puzzle.actionLabel ?? `解开：${puzzle.title}`)}</button>`,
              )
              .join('')}
            ${renderChoiceButtons(siteCtx, node, choices)}
          </div>
        </section>
      </main>`
    bindChoices()
    bind('[data-action="dismiss-tutorial"]', () => {
      if (!tutorial) return
      game.markTutorialSeen(tutorial)
      save()
      renderNode()
    })
    bind('[data-action="open-evidence"]', () => handbook.open('evidence', 'story'))
    root.querySelectorAll<HTMLElement>('[data-puzzle-choice]').forEach((button) => {
      button.addEventListener('click', () => handbook.open('puzzles', 'story', button.dataset.puzzleChoice))
    })
    bind('[data-action="handbook"]', () => handbook.open('hub', 'handbook'))
    bindMute()
    typewriter.init(root)
    lastRenderedNodeId = node.id
    if (showStageCutscene) openStageCutscene(stageCtx)
    const cardEl = root.querySelector<HTMLElement>('.card')
    if (cardEl && fx.unstable) startUnstable(cardEl, fx.unstable)
    notifyNewAchievements()
  }

  /** 节点正文渲染：blocks 存在时分类型排版，否则普通段落 */
  function renderChoiceResponse(): string {
    const trace = game.state.lastChoice
    if (!trace?.response || trace.targetNodeId !== game.state.nodeId) return ''
    return `<aside class="choice-response" data-choice-response="true">${esc(game.interpolate(trace.response))}</aside>`
  }

  function typewriterAttr(textReveal: PresentationConfig['textReveal']): string {
    return textReveal === 'typewriter' || textReveal === 'terminal'
      ? ` data-text-reveal="${textReveal}"`
      : ''
  }

  function renderBody(node: StoryNode, textReveal: PresentationConfig['textReveal'] = 'instant'): string {
    const blocks = node.blocks
    if (blocks?.length) {
      return blocks.map((b) => renderBlock(b, textReveal)).join('')
    }
    return `<div class="card-text"${typewriterAttr(textReveal)}>${esc(game.interpolate(node.text))}</div>`
  }

  function renderBlock(block: TextBlock, textReveal: PresentationConfig['textReveal'] = 'instant'): string {
    const hasSegments = Boolean(block.segments?.length)
    const text = hasSegments
      ? block.segments!.map((segment) => renderSegment(segment)).join('')
      : esc(game.interpolate(block.text))
    switch (block.type) {
      case 'title':
        return `<h3 class="block-title">${hasSegments ? text : esc(block.title ?? game.interpolate(block.text))}</h3>`
      case 'rules':
        return `<div class="block block-rules"><div class="block-head">${esc(block.title ?? '规则')}</div><div class="block-body">${text}</div></div>`
      case 'note':
        return `<div class="block block-note"><div class="block-head">${esc(block.title ?? '便条')}</div><div class="block-body">${text}</div></div>`
      case 'letter':
        return `<div class="block block-letter"><div class="block-head">${esc(block.title ?? '信')}</div><div class="block-body">${text}</div></div>`
      default:
        // 带受控片段的 para 保持条件揭示逻辑，不参与逐字输出。
        return `<p class="block-para"${hasSegments ? '' : typewriterAttr(textReveal)}>${text}</p>`
    }
  }

/**
   * 只渲染 schema 允许的片段样式；条件未满足时，真实文本不会进入 DOM。
   * 这让遮挡可用于谜题，同时避免任意 HTML/CSS 成为导出作品的注入入口。
   */
  function renderSegment(segment: TextSegment): string {
    const revealed = game.meets(segment.revealWhen)
    const style = segment.style
    if (!revealed) {
      const placeholder = concealedText(game.interpolate(segment.text), style)
      const styleClass = style ? ` segment-${style}` : ''
      return `<span class="text-segment segment-concealed${styleClass}" aria-label="内容尚未揭示"><span aria-hidden="true">${esc(placeholder)}</span></span>`
    }

    const wasConcealed = Boolean(segment.revealWhen && ['redacted', 'glitch', 'corrupt'].includes(style ?? ''))
    const styleClass = wasConcealed ? ' segment-revealed' : (style ? ` segment-${style}` : '')
    return `<span class="text-segment${styleClass}">${esc(game.interpolate(segment.text))}</span>`
  }

  function concealedText(text: string, style: TextSegment['style']): string {
    if (!text) return '…'
    const visible = Array.from(text).slice(0, 36)
    if (style === 'redacted') return visible.map((char) => /\s/u.test(char) ? char : '█').join('')
    if (style === 'glitch') {
      const glyphs = ['▓', '▒', '░', '#', '?']
      return visible.map((char, index) => /\s/u.test(char) ? char : glyphs[(char.codePointAt(0)! + index) % glyphs.length]).join('')
    }
    if (style === 'corrupt') {
      const glyphs = ['�', '0', '1', '¤']
      return visible.map((char, index) => /\s/u.test(char) ? char : glyphs[(char.codePointAt(0)! + index) % glyphs.length]).join('')
    }
    return '…'
  }

  function renderEnding(ending: EndingMeta, step: number, transitionClass = ''): void {
    typewriter.clear()
    clearStageCutscene(stageCtx)
    const kindLabel: Record<EndingMeta['kind'], string> = {
      good: '结局 · 生还',
      bad: '结局 · 终焉',
      true: '结局 · 真相',
      hidden: '结局 · 隐藏',
    }
    const node = game.currentNode
    const presentation = effectivePresentation(node)
    playSfx(`ending_${ending.kind}` as SfxName)
    const fx = cardFx(node)
    root.innerHTML = `
      <main class="screen game-screen ${presentationClasses(node)} ${transitionClass}" data-node-id="${esc(node.id)}" data-ending-id="${esc(ending.id)}" data-world="${esc(game.state.world)}" data-phase="${esc(game.state.phase)}"${story.meta.site ? ` data-site-kind="${story.meta.site.kind}" data-page-layout="${node.page?.layout ?? siteDefaultLayout(story.meta.site.kind)}"${node.page?.composition ? ` data-page-composition="${node.page.composition}"` : ''}` : ''}>
        ${renderGameHeader(siteCtx, step)}
        ${handbook.fabHtml()}
        ${node.stage && node.stage !== 'clear' ? stageCtx.renderStageHtml() : ''}
        <section class="card card-ending ending-${ending.kind} ${fx.cls}" style="${fx.style}">
          ${renderPageHeader(siteCtx, node)}
          <div class="ending-badge">${kindLabel[ending.kind]}</div>
          <h2 class="ending-title">${esc(ending.title)}</h2>
          ${renderChoiceResponse()}
          ${renderBody(node, presentation.textReveal)}
          <div class="card-actions ending-actions">
            <button class="btn btn-primary" data-action="replay">${story.meta.site?.kind === 'news' ? '重新浏览' : '再来一次'}</button>
            <button class="btn btn-ghost" data-action="title">${story.meta.site?.kind === 'news' ? '返回首页' : '返回标题'}</button>
          </div>
        </section>
      </main>`
    bind('[data-action="handbook"]', () => handbook.open('hub', 'handbook'))
    bindMute()
    typewriter.init(root)
    bind('[data-action="replay"]', () => {
      game = new Game(story)
      lastAchievements = [...game.state.achievements]
      lastEvidence = []
      handbook.resetState()
      lastRenderedNodeId = null
      save()
      renderNode()
    })
    bind('[data-action="title"]', () => renderTitle())
    const cardEl = root.querySelector<HTMLElement>('.card')
    if (cardEl && fx.unstable) startUnstable(cardEl, fx.unstable)
    notifyNewAchievements()
  }

  /* ------------------------------ 事件 ------------------------------ */

  function bindIn(container: HTMLElement, selector: string, handler: () => void): void {
    container.querySelectorAll(selector).forEach((element) => element.addEventListener('click', handler))
  }

  function bind(selector: string, handler: () => void): void {
    bindIn(root, selector, handler)
  }

  function bindChoices(): void {
    root.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const index = Number(btn.dataset.choice)
        root.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((b) => (b.disabled = true))
        playSfx('click')
        game.choose(index)
        renderNode()
      })
    })
  }

  /* ------------------------------ 启动 ------------------------------ */

  function handleKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
    const overlayOpen = root.querySelector('.handbook-overlay') !== null
    const stageCutscene = root.querySelector<HTMLElement>('.stage-cutscene')
    if (stageCutscene) {
      if (event.key === 'Escape') {
        event.preventDefault()
        clearStageCutscene(stageCtx)
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        stageCutscene.querySelector<HTMLElement>('[data-action="stage-advance"]')?.click()
        return
      }
      return
    }
    if (event.key === 'Escape') {
      if (overlayOpen) {
        event.preventDefault()
        handbook.close()
      }
      return
    }
    if (event.key === 'Enter' && typewriter.activeCount > 0) {
      event.preventDefault()
      typewriter.finishAll()
      return
    }
    if (overlayOpen) return
    switch (event.key.toLowerCase()) {
      case 'h':
        handbook.open('hub', 'handbook')
        break
      case 'c':
        handbook.open('characters', 'handbook')
        break
      case 'i':
        handbook.open('docs', 'handbook')
        break
      case 'r':
        handbook.open('evidence', 'handbook')
        break
      case 'p':
        handbook.open('puzzles', 'handbook')
        break
    }
  }

  document.addEventListener('keydown', handleKeydown)
  renderTitle()
  return {
    async destroy(): Promise<void> {
      document.removeEventListener('keydown', handleKeydown)
      clearUnstable()
      typewriter.clear()
      clearStageCutscene(stageCtx)
      root.replaceChildren()
      await disposeSfx()
    },
  }
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** CSS 属性选择器中的值转义（现代浏览器优先 CSS.escape，测试环境回退）。 */
function cssEscape(text: string): string {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(text) : text.replace(/["\\]/g, '\\$&')
}
