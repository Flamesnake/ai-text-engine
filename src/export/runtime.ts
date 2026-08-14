import { Game } from '../core/engine.js'
import type { EndingMeta, GameState, PresentationConfig, SoundscapeSpec, StateAppearance, Story, StoryNode, TextBlock, TextSegment, ThemeConfig } from '../core/types.js'
import { disposeSfx, initSfx, isMuted, playSfx, setSoundscape, toggleMuted, type SfxName } from './sfx.js'
import { resolveTheme } from './themes.js'

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

export function mountTextAdventure(root: HTMLElement, story: Story, options?: MountOptions): MountedTextAdventure {
  const storage = options?.storage ?? window.localStorage
  const saveKey = options?.saveKey ?? `ate:${story.meta.title}`
  let game: Game
  /** 上次渲染时的成就快照（用于检测新解锁弹 toast） */
  let lastAchievements: string[] = []
  /** 上次场景渲染时已拥有的证据，用于只提示本次新增项。 */
  let lastEvidence: string[] = []
  /** 不稳定灯随机爆发定时器 */
  let unstableTimer: ReturnType<typeof setTimeout> | null = null
  let lastRenderedStateKey: string | null = null

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
      const spec = typeof item === 'string' ? { name: item } : item
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
  }

  /** 全局只定义一次，节点仅覆盖差异项；返回稳定 class 供 CSS 外壳组合。 */
  function presentationClasses(node?: StoryNode): string {
    const statePresentation = currentAppearances().reduce<PresentationConfig>(
      (merged, appearance) => ({ ...merged, ...(appearance.presentation ?? {}) }),
      {},
    )
    const p = {
      ...presentationDefaults,
      ...(story.meta.presentation ?? {}),
      ...statePresentation,
      ...(node?.presentation ?? {}),
    }
    return [
      `shell-${p.shell}`,
      `type-${p.typography}`,
      `density-${p.density}`,
      `shape-${p.shape}`,
      `choice-${p.choiceStyle}`,
    ].join(' ')
  }

  function renderTitle(): void {
    clearUnstable()
    setSoundscape(null)
    applyTheme(false)
    lastRenderedStateKey = null
    const has = hasSave()
    const achCount = (story.achievements ?? []).length
    root.innerHTML = `
      <main class="screen title-screen ${presentationClasses()}">
        <div class="title-badge">TEXT ADVENTURE</div>
        <h1 class="title-main">${esc(story.meta.title)}</h1>
        ${story.meta.subtitle ? `<p class="title-sub">${esc(story.meta.subtitle)}</p>` : ''}
        <div class="title-actions">
          <button class="btn btn-primary" data-action="start">开始游戏</button>
          ${has ? '<button class="btn" data-action="continue">继续上次</button>' : ''}
          ${has ? '<button class="btn btn-ghost" data-action="clear">清除存档</button>' : ''}
          ${achCount > 0 ? '<button class="btn btn-ghost" data-action="achievements">成就</button>' : ''}
        </div>
        <p class="title-foot">${muteButtonHtml()}</p>
      </main>`
    bind('[data-action="start"]', () => {
      game = new Game(story)
      lastAchievements = [...game.state.achievements]
      lastEvidence = []
      save()
      renderNode()
    })
    bind('[data-action="continue"]', () => {
      game = new Game(story, load())
      lastAchievements = [...game.state.achievements]
      lastEvidence = [...game.state.evidence]
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
    const achievements = story.achievements ?? []
    const unlocked = load()?.achievements ?? []
    root.innerHTML = `
      <main class="screen title-screen achievements-screen ${presentationClasses()}">
        <div class="title-badge">ACHIEVEMENTS</div>
        <h2 class="ach-heading">成就</h2>
        <p class="ach-count">已解锁 ${unlocked.length} / ${achievements.length}</p>
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
          <button class="btn" data-action="back">返回</button>
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
      .map((a) => `<div class="ach-toast-item">${esc(a.icon ?? '🏆')} 成就解锁：${esc(a.title)}</div>`)
      .join('')
    root.appendChild(toast)
    playSfx('achievement')
    setTimeout(() => toast.remove(), 3200)
  }

  function renderNode(): void {
    save()
    const node = game.currentNode
    const step = game.stepCount
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
    const tutorial = activeTutorial(scenePuzzles.length > 0)
    playNodeSfx(node)
    const fx = cardFx(node)
    root.innerHTML = `
      <main class="screen game-screen ${presentationClasses(node)} ${transitionClass}" data-node-id="${esc(node.id)}" data-world="${esc(game.state.world)}" data-phase="${esc(game.state.phase)}">
        <header class="game-header">
          <span class="game-title">${esc(story.meta.title)}</span>
          <span class="game-step">第 ${step} 步</span>
          ${puzzlesButton()}
          ${charactersButton()}
          ${evidenceBoardButton()}
          ${docsButton()}
          ${muteButtonHtml()}
        </header>
        ${renderHud()}
        ${renderInventory(game.state.inventory)}
        ${node.objective ? `<aside class="scene-objective"><strong>当前目标</strong><span>${esc(game.interpolate(node.objective))}</span></aside>` : ''}
        ${newEvidence.length > 0 ? `<aside class="evidence-notice"><strong>新证据</strong><span>${newEvidence.map((id) => esc(story.evidence?.[id]?.title ?? id)).join('、')}已加入推理板，可与其他证据组合。</span></aside>` : ''}
        ${tutorial ? tutorialBanner(tutorial) : ''}
        <section class="card ${fx.cls}" style="${fx.style}">
          ${renderChoiceResponse()}
          ${renderBody(node)}
          <div class="card-actions">
            ${deductionAction()}
            ${scenePuzzles
              .map(
                (puzzle) =>
                  `<button class="btn btn-primary puzzle-choice" data-puzzle-choice="${esc(puzzle.id)}">${esc(puzzle.actionLabel ?? `解开：${puzzle.title}`)}</button>`,
              )
              .join('')}
            ${choices
              .map(
                (c, i) =>
                  `<button class="btn choice-btn" data-choice="${i}" data-choice-label="${esc(c.label)}" data-choice-target="${esc(c.target)}">${esc(game.interpolate(c.label))}</button>`,
              )
              .join('')}
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
    bind('[data-deduction-choice]', () => renderEvidenceBoard())
    root.querySelectorAll<HTMLElement>('[data-puzzle-choice]').forEach((button) => {
      button.addEventListener('click', () => renderPuzzles('', button.dataset.puzzleChoice))
    })
    bind('[data-action="docs"]', () => renderDocsList())
    bind('[data-action="evidence-board"]', () => renderEvidenceBoard())
    bind('[data-action="characters"]', () => renderCharacters())
    bind('[data-action="puzzles"]', () => renderPuzzles())
    bindMute()
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

  function renderBody(node: StoryNode): string {
    const blocks = node.blocks
    if (blocks?.length) {
      return blocks.map((b) => renderBlock(b)).join('')
    }
    return `<div class="card-text">${esc(game.interpolate(node.text))}</div>`
  }

  function renderBlock(block: TextBlock): string {
    const text = block.segments?.length
      ? block.segments.map((segment) => renderSegment(segment)).join('')
      : esc(game.interpolate(block.text))
    switch (block.type) {
      case 'title':
        return `<h3 class="block-title">${block.segments?.length ? text : esc(block.title ?? game.interpolate(block.text))}</h3>`
      case 'rules':
        return `<div class="block block-rules"><div class="block-head">${esc(block.title ?? '规则')}</div><div class="block-body">${text}</div></div>`
      case 'note':
        return `<div class="block block-note"><div class="block-head">${esc(block.title ?? '便条')}</div><div class="block-body">${text}</div></div>`
      case 'letter':
        return `<div class="block block-letter"><div class="block-head">${esc(block.title ?? '信')}</div><div class="block-body">${text}</div></div>`
      default:
        return `<p class="block-para">${text}</p>`
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

  /** 游戏画面右上角的线索入口（有线索时显示） */
  function docsButton(): string {
    if (game.state.docs.length === 0 || !story.documents) return ''
    return `<button class="btn btn-ghost docs-btn" data-action="docs">线索 ${game.state.docs.length}</button>`
  }

  function evidenceBoardButton(): string {
    if (game.state.evidence.length === 0 || !story.evidence || !story.deductions) return ''
    return `<button class="btn btn-ghost docs-btn" data-action="evidence-board">推理板 ${game.state.evidence.length}</button>`
  }

  function deductionAction(): string {
    const hasUnconfirmed = Object.values(story.deductions ?? {}).some(
      (deduction) => !game.state.deductions.includes(deduction.id),
    )
    if (game.state.evidence.length === 0 || !hasUnconfirmed) return ''
    return `<button class="btn btn-primary deduction-choice" data-deduction-choice>整理线索并推理（${game.state.evidence.length} 条）</button>`
  }

  function activeTutorial(hasPuzzle: boolean): 'deduction' | 'puzzle' | 'relationship' | null {
    const hasUnconfirmedDeduction = game.state.evidence.length > 0 && Object.values(story.deductions ?? {})
      .some((deduction) => !game.state.deductions.includes(deduction.id))
    if (hasPuzzle && !game.hasSeenTutorial('puzzle')) return 'puzzle'
    if (hasUnconfirmedDeduction && !game.hasSeenTutorial('deduction')) return 'deduction'
    if (story.characters && Object.keys(story.characters).length > 0 && !game.hasSeenTutorial('relationship')) return 'relationship'
    return null
  }

  function tutorialBanner(kind: 'deduction' | 'puzzle' | 'relationship'): string {
    const content = {
      deduction: ['推理板', '收集到的证据会进入推理板。选择一个推论并组合支持它的证据，可以解锁新的行动与结局。'],
      puzzle: ['场景谜题', '醒目的谜题行动可以直接尝试；答案来自场景信息，遇到困难可查看渐进提示或返回调查。'],
      relationship: ['人物关系', '你的回应会改变人物的信任与记忆，从而影响证词、秘密、行动或结局。'],
    }[kind]
    return `<aside class="tutorial-banner" data-tutorial="${kind}"><div><strong>${content[0]}</strong><span>${content[1]}</span></div><button class="btn btn-ghost" data-action="dismiss-tutorial">知道了</button></aside>`
  }

  function charactersButton(): string {
    if (!story.characters || Object.keys(story.characters).length === 0) return ''
    return `<button class="btn btn-ghost docs-btn" data-action="characters">人物</button>`
  }

  function puzzlesButton(): string {
    if (!story.puzzles || (game.availablePuzzles().length === 0 && game.state.solvedPuzzles.length === 0)) return ''
    const unsolved = game.availablePuzzles().length
    return `<button class="btn btn-ghost docs-btn" data-action="puzzles">谜题${unsolved > 0 ? ` ${unsolved}` : ''}</button>`
  }

  /** 密码谜题页：确定性答案验证、错误次数和渐进提示。 */
  function renderPuzzles(message = '', preferredId?: string): void {
    clearUnstable()
    const available = game.availablePuzzles()
    const solved = game.state.solvedPuzzles
      .map((id) => story.puzzles?.[id])
      .filter((puzzle): puzzle is NonNullable<typeof puzzle> => Boolean(puzzle))
    const puzzles = [...available, ...solved.filter((puzzle) => !available.some((item) => item.id === puzzle.id))]
    const active = puzzles.find((puzzle) => puzzle.id === preferredId) ?? puzzles[0]
    const revealedCount = active ? (game.state.puzzleHints[active.id] ?? 0) : 0
    const revealedHints = active?.hints?.slice(0, revealedCount) ?? []
    const isSolved = active ? game.state.solvedPuzzles.includes(active.id) : false
    root.innerHTML = `
      <main class="screen game-screen ${presentationClasses()}">
        <header class="game-header"><span class="game-title">谜题</span><span class="game-step">${puzzles.length} 项</span></header>
        ${active ? `<section class="card puzzle-card" data-puzzle="${esc(active.id)}">
          <h2 class="puzzle-title">${esc(active.title)}</h2>
          <p class="puzzle-prompt">${esc(active.prompt)}</p>
          ${isSolved ? '<div class="puzzle-solved">已解开</div>' : `<input class="puzzle-answer" data-puzzle-answer="${esc(active.id)}" autocomplete="off" aria-label="谜题答案"/>
          <div class="card-actions puzzle-actions">
            <button class="btn btn-primary" data-action="attempt-puzzle">提交答案</button>
            ${active.hints?.length ? '<button class="btn btn-ghost" data-action="puzzle-hint">查看提示</button>' : ''}
          </div>`}
          <div data-puzzle-hints class="puzzle-hints">${revealedHints.map((hint, index) => `<p>提示 ${index + 1}：${esc(hint)}</p>`).join('')}</div>
          <p data-puzzle-result class="puzzle-result">${esc(message)}</p>
        </section>` : '<section class="card"><p>当前没有可用谜题。</p></section>'}
        <div class="card-actions"><button class="btn" data-action="back">返回</button></div>
      </main>`
    bind('[data-action="back"]', () => renderNode())
    bind('[data-action="attempt-puzzle"]', () => {
      if (!active) return
      const answer = root.querySelector<HTMLInputElement>(`[data-puzzle-answer="${cssEscape(active.id)}"]`)?.value ?? ''
      const result = game.attemptPuzzle(active.id, answer)
      save()
      renderPuzzles(
        result.solved ? '谜题已解开。新的行动可能已经解锁。' : `答案不正确，已尝试 ${result.attempts} 次。`,
        active.id,
      )
    })
    bind('[data-action="puzzle-hint"]', () => {
      if (!active) return
      const result = game.revealPuzzleHint(active.id)
      save()
      renderPuzzles(result.hint ? `已揭示提示 ${result.revealed} / ${result.total}` : '没有更多提示。', active.id)
    })
  }

  /** 人物页：展示人物说明、当前关系与已揭示/未知秘密。 */
  function renderCharacters(): void {
    clearUnstable()
    const characters = Object.values(story.characters ?? {})
    root.innerHTML = `
      <main class="screen game-screen ${presentationClasses()}">
        <header class="game-header"><span class="game-title">人物</span><span class="game-step">${characters.length} 人</span></header>
        <div class="character-list">${characters.map((character) => {
          const stats = Object.entries(character.relations ?? {})
          const secrets = Object.entries(character.secrets ?? {})
          return `<section class="card character-card" data-character="${esc(character.id)}">
            <h2 class="character-name">${esc(character.name)}</h2>
            <p class="character-description">${esc(character.description)}</p>
            <div class="relation-list">${stats.map(([stat, definition]) =>
              `<span class="relation-chip">${esc(definition.label)} ${game.state.relations[character.id]?.[stat] ?? definition.initial ?? 0}</span>`,
            ).join('')}</div>
            <div class="secret-list">${secrets.map(([secretId, secret]) => {
              const ref = `${character.id}:${secretId}`
              const revealed = game.state.revealedSecrets.includes(ref)
              return `<article class="secret-item ${revealed ? 'secret-revealed' : 'secret-unknown'}" data-secret="${esc(ref)}">
                <strong>${revealed ? esc(secret.title) : '未知秘密'}</strong>
                <span>${revealed ? esc(secret.description) : '继续与这个人物互动，或许能发现更多。'}</span>
              </article>`
            }).join('')}</div>
          </section>`
        }).join('')}</div>
        <div class="card-actions"><button class="btn" data-action="back">返回</button></div>
      </main>`
    bind('[data-action="back"]', () => renderNode())
  }

  /** 推理板：选择推论和证据，提交给 Game 的确定性推论接口。 */
  function renderEvidenceBoard(resultMessage = ''): void {
    clearUnstable()
    const owned = game.state.evidence
      .map((id) => story.evidence?.[id])
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    const deductions = Object.values(story.deductions ?? {})
    root.innerHTML = `
      <main class="screen game-screen ${presentationClasses()}">
        <header class="game-header"><span class="game-title">推理板</span><span class="game-step">${owned.length} 条证据</span></header>
        <section class="card deduction-board">
          <p class="deduction-guide">先选择一项待证明的推论，再勾选支持它的证据，最后点击“验证推论”。证据不足时可以返回场景继续调查。</p>
          <h2 class="deduction-heading">待证明的推论</h2>
          <div class="deduction-list">${deductions.map((deduction, index) => {
            const confirmed = game.state.deductions.includes(deduction.id)
            const ownedSet = new Set(game.state.evidence)
            const required = deduction.requires.all ?? []
            const alternativeGroups = deduction.requires.anyOf ?? []
            const requiredOwned = required.filter((id) => ownedSet.has(id)).length
            const groupsMet = alternativeGroups.filter((group) => group.some((id) => ownedSet.has(id))).length
            const canConfirm = requiredOwned === required.length && groupsMet === alternativeGroups.length
            return `<label class="deduction-item ${confirmed ? 'deduction-confirmed' : ''}" data-deduction="${esc(deduction.id)}" data-deduction-can-confirm="${canConfirm}">
              <input type="radio" name="deduction" value="${esc(deduction.id)}" ${index === 0 ? 'checked' : ''} ${confirmed ? 'disabled' : ''}/>
              <span><strong>${esc(deduction.statement)}${confirmed ? ' · 已成立' : ''}</strong>
                <small data-deduction-progress="${esc(deduction.id)}">必需证据 ${requiredOwned}/${required.length}${alternativeGroups.length > 0 ? ` · 替代证据组 ${groupsMet}/${alternativeGroups.length}` : ''}</small>
                ${deduction.hint && !confirmed ? `<small data-deduction-hint="${esc(deduction.id)}">调查方向：${esc(deduction.hint)}</small>` : ''}
              </span>
            </label>`
          }).join('')}</div>
          <h2 class="deduction-heading">选择支持证据</h2>
          <div class="evidence-list">${owned.map((evidence) => `<label class="evidence-item">
            <input type="checkbox" data-evidence value="${esc(evidence.id)}"/>
            <span><strong>${esc(evidence.title)}</strong><small>${esc(evidence.description)}</small></span>
          </label>`).join('')}</div>
          <p data-deduction-result class="deduction-result">${esc(resultMessage)}</p>
          <div class="card-actions">
            <button class="btn btn-primary" data-action="confirm-deduction">验证推论</button>
            <button class="btn" data-action="back">返回</button>
          </div>
        </section>
      </main>`
    bind('[data-action="back"]', () => renderNode())
    bind('[data-action="confirm-deduction"]', () => {
      const deductionId = root.querySelector<HTMLInputElement>('input[name="deduction"]:checked')?.value
      const selected = [...root.querySelectorAll<HTMLInputElement>('[data-evidence]:checked')].map((input) => input.value)
      const success = deductionId ? game.confirmDeduction(deductionId, selected) : false
      if (success) save()
      renderEvidenceBoard(success ? '推论成立。新的行动可能已经解锁。' : '证据不足，或这些证据无法支持该推论。')
    })
  }

  /** 线索夹列表画面 */
  function renderDocsList(): void {
    clearUnstable()
    playSfx('page')
    const owned = game.state.docs
      .map((id) => story.documents?.[id])
      .filter((d): d is NonNullable<typeof d> => Boolean(d))
    root.innerHTML = `
      <main class="screen game-screen ${presentationClasses()}">
        <header class="game-header">
          <span class="game-title">线索夹</span>
          <span class="game-step">${owned.length} 份</span>
        </header>
        <div class="doc-list">
          ${owned
            .map(
              (d) => `<button class="doc-item" data-doc="${esc(d.id)}">
                <span class="doc-kind">${esc(docKindLabel(d.kind))}</span>
                <span class="doc-title">${esc(d.title)}</span>
              </button>`,
            )
            .join('')}
        </div>
        <div class="card-actions">
          <button class="btn" data-action="back">返回</button>
        </div>
      </main>`
    bind('[data-action="back"]', () => renderNode())
    root.querySelectorAll<HTMLButtonElement>('[data-doc]').forEach((btn) => {
      btn.addEventListener('click', () => renderDocDetail(btn.dataset.doc!))
    })
  }

  /** 单个线索查看画面 */
  function renderDocDetail(docId: string): void {
    clearUnstable()
    playSfx('page')
    const doc = story.documents?.[docId]
    if (!doc) return
    root.innerHTML = `
      <main class="screen game-screen ${presentationClasses()}">
        <header class="game-header">
          <span class="game-title">线索夹</span>
          <span class="game-step">${esc(docKindLabel(doc.kind))}</span>
        </header>
        <section class="card">
          <div class="block block-${esc(doc.kind ?? 'doc')}">
            <div class="block-head">${esc(doc.title)}</div>
            <div class="block-body">${esc(game.interpolate(doc.text))}</div>
          </div>
        </section>
        <div class="card-actions">
          <button class="btn" data-action="back">返回列表</button>
        </div>
      </main>`
    bind('[data-action="back"]', () => renderDocsList())
  }

  function renderEnding(ending: EndingMeta, step: number, transitionClass = ''): void {
    const kindLabel: Record<EndingMeta['kind'], string> = {
      good: '结局 · 生还',
      bad: '结局 · 终焉',
      true: '结局 · 真相',
      hidden: '结局 · 隐藏',
    }
    const node = game.currentNode
    playSfx(`ending_${ending.kind}` as SfxName)
    const fx = cardFx(node)
    root.innerHTML = `
      <main class="screen game-screen ${presentationClasses(node)} ${transitionClass}" data-node-id="${esc(node.id)}" data-ending-id="${esc(ending.id)}" data-world="${esc(game.state.world)}" data-phase="${esc(game.state.phase)}">
        <header class="game-header">
          <span class="game-title">${esc(story.meta.title)}</span>
          <span class="game-step">第 ${step} 步</span>
          ${puzzlesButton()}
          ${charactersButton()}
          ${evidenceBoardButton()}
          ${docsButton()}
          ${muteButtonHtml()}
        </header>
        <section class="card card-ending ending-${ending.kind} ${fx.cls}" style="${fx.style}">
          <div class="ending-badge">${kindLabel[ending.kind]}</div>
          <h2 class="ending-title">${esc(ending.title)}</h2>
          ${renderChoiceResponse()}
          ${renderBody(node)}
          <div class="card-actions ending-actions">
            <button class="btn btn-primary" data-action="replay">再来一次</button>
            <button class="btn btn-ghost" data-action="title">返回标题</button>
          </div>
        </section>
      </main>`
    bind('[data-action="docs"]', () => renderDocsList())
    bind('[data-action="evidence-board"]', () => renderEvidenceBoard())
    bind('[data-action="characters"]', () => renderCharacters())
    bind('[data-action="puzzles"]', () => renderPuzzles())
    bindMute()
    bind('[data-action="replay"]', () => {
      game = new Game(story)
      lastAchievements = [...game.state.achievements]
      lastEvidence = []
      save()
      renderNode()
    })
    bind('[data-action="title"]', () => renderTitle())
    const cardEl = root.querySelector<HTMLElement>('.card')
    if (cardEl && fx.unstable) startUnstable(cardEl, fx.unstable)
    notifyNewAchievements()
  }

  function renderInventory(inventory: string[]): string {
    if (inventory.length === 0) return ''
    return `<div class="inventory">${inventory
      .map((item) => `<span class="inv-chip">${esc(item)}</span>`)
      .join('')}</div>`
  }

  /** HUD 统计条（meta.hud：好感度/理智值等数值变量；var 可为 #day） */
  function renderHud(): string {
    const hud = story.meta.hud
    if (!hud?.length) return ''
    return `<div class="hud">${hud
      .map((stat) => {
        const raw = stat.var === '#day' ? game.state.day : game.state.vars[stat.var]
        const value = typeof raw === 'number' ? raw : 0
        const max = stat.max ?? 100
        const pct = Math.max(0, Math.min(100, (value / max) * 100))
        return `<div class="hud-stat">
          <span class="hud-label">${esc(stat.label)}</span>
          <div class="hud-bar"><div class="hud-fill" style="width:${pct}%"></div></div>
          <span class="hud-value">${value}${stat.max ? ` / ${stat.max}` : ''}</span>
        </div>`
      })
      .join('')}</div>`
  }

  /* ------------------------------ 事件 ------------------------------ */

  function bind(selector: string, handler: () => void): void {
    root.querySelector(selector)?.addEventListener('click', handler)
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

  renderTitle()
  return {
    async destroy(): Promise<void> {
      clearUnstable()
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

/** 文档/块类型 → 中文标签 */
function docKindLabel(kind?: string): string {
  switch (kind) {
    case 'rules':
      return '守则'
    case 'note':
      return '便条'
    case 'letter':
      return '信'
    case 'title':
      return '标题'
    default:
      return '文档'
  }
}
