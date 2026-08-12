import { Game } from '../core/engine.js'
import type { EndingMeta, GameState, Story, StoryNode, TextBlock } from '../core/types.js'
import { initSfx, isMuted, playSfx, toggleMuted, type SfxName } from './sfx.js'

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

export function mountTextAdventure(root: HTMLElement, story: Story, options?: MountOptions): void {
  const storage = options?.storage ?? window.localStorage
  const saveKey = options?.saveKey ?? `ate:${story.meta.title}`
  let game: Game
  /** 上次渲染时的成就快照（用于检测新解锁弹 toast） */
  let lastAchievements: string[] = []

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

  /** 节点卡片动画 class（node.fx） */
  function cardFx(node: StoryNode): string {
    return (node.fx ?? []).map((f) => `fx-${f}`).join(' ')
  }

  /** 播放节点音效（node.sfx，未知名静默） */
  function playNodeSfx(node: StoryNode): void {
    if (node.sfx) playSfx(node.sfx as SfxName)
  }

  function renderTitle(): void {
    const has = hasSave()
    const achCount = (story.achievements ?? []).length
    root.innerHTML = `
      <main class="screen title-screen">
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
      save()
      renderNode()
    })
    bind('[data-action="continue"]', () => {
      game = new Game(story, load())
      lastAchievements = [...game.state.achievements]
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
    const achievements = story.achievements ?? []
    const unlocked = load()?.achievements ?? []
    root.innerHTML = `
      <main class="screen title-screen achievements-screen">
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
    if (game.isEnding && node.ending) {
      renderEnding(node.ending, step)
      return
    }
    const choices = game.visibleChoices()
    playNodeSfx(node)
    root.innerHTML = `
      <main class="screen game-screen">
        <header class="game-header">
          <span class="game-title">${esc(story.meta.title)}</span>
          <span class="game-step">第 ${step} 步</span>
          ${docsButton()}
          ${muteButtonHtml()}
        </header>
        ${renderHud()}
        ${renderInventory(game.state.inventory)}
        <section class="card ${cardFx(node)}">
          ${renderBody(node)}
          <div class="card-actions">
            ${choices
              .map(
                (c, i) =>
                  `<button class="btn choice-btn" data-choice="${i}">${esc(game.interpolate(c.label))}</button>`,
              )
              .join('')}
          </div>
        </section>
      </main>`
    bindChoices()
    bind('[data-action="docs"]', () => renderDocsList())
    bindMute()
    notifyNewAchievements()
  }

  /** 节点正文渲染：blocks 存在时分类型排版，否则普通段落 */
  function renderBody(node: StoryNode): string {
    const blocks = node.blocks
    if (blocks?.length) {
      return blocks.map((b) => renderBlock(b)).join('')
    }
    return `<div class="card-text">${esc(game.interpolate(node.text))}</div>`
  }

  function renderBlock(block: TextBlock): string {
    const text = esc(game.interpolate(block.text))
    switch (block.type) {
      case 'title':
        return `<h3 class="block-title">${esc(block.title ?? game.interpolate(block.text))}</h3>`
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

  /** 游戏画面右上角的线索入口（有线索时显示） */
  function docsButton(): string {
    if (game.state.docs.length === 0 || !story.documents) return ''
    return `<button class="btn btn-ghost docs-btn" data-action="docs">线索 ${game.state.docs.length}</button>`
  }

  /** 线索夹列表画面 */
  function renderDocsList(): void {
    playSfx('page')
    const owned = game.state.docs
      .map((id) => story.documents?.[id])
      .filter((d): d is NonNullable<typeof d> => Boolean(d))
    root.innerHTML = `
      <main class="screen game-screen">
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
    playSfx('page')
    const doc = story.documents?.[docId]
    if (!doc) return
    root.innerHTML = `
      <main class="screen game-screen">
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

  function renderEnding(ending: EndingMeta, step: number): void {
    const kindLabel: Record<EndingMeta['kind'], string> = {
      good: '结局 · 生还',
      bad: '结局 · 终焉',
      true: '结局 · 真相',
      hidden: '结局 · 隐藏',
    }
    const node = game.currentNode
    playSfx(`ending_${ending.kind}` as SfxName)
    root.innerHTML = `
      <main class="screen game-screen">
        <header class="game-header">
          <span class="game-title">${esc(story.meta.title)}</span>
          <span class="game-step">第 ${step} 步</span>
          ${docsButton()}
          ${muteButtonHtml()}
        </header>
        <section class="card card-ending ending-${ending.kind} ${cardFx(node)}">
          <div class="ending-badge">${kindLabel[ending.kind]}</div>
          <h2 class="ending-title">${esc(ending.title)}</h2>
          ${renderBody(node)}
          <div class="card-actions ending-actions">
            <button class="btn btn-primary" data-action="replay">再来一次</button>
            <button class="btn btn-ghost" data-action="title">返回标题</button>
          </div>
        </section>
      </main>`
    bind('[data-action="docs"]', () => renderDocsList())
    bindMute()
    bind('[data-action="replay"]', () => {
      game = new Game(story)
      lastAchievements = [...game.state.achievements]
      save()
      renderNode()
    })
    bind('[data-action="title"]', () => renderTitle())
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
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
