/**
 * 调查手册控制器（P2-2 拆分）：人物 / 线索夹 / 推理板 / 谜题 / HUD。
 * 共享可变状态（刷新标记、已揭示提示）内聚于控制器，宿主通过 ctx 提供依赖。
 */
import type { Deduction, Story } from '../../core/types.js'
import type { Game } from '../../core/engine.js'
import type { SfxName } from '../sfx.js'

export type ToolKind = 'hub' | 'characters' | 'docs' | 'evidence' | 'puzzles'
export type ToolBack = 'story' | 'handbook'

export interface HandbookCtx {
  story: Story
  root: HTMLElement
  /** 当前游戏实例（延迟求值：标题屏阶段尚未创建）。 */
  game: () => Game
  esc: (text: string) => string
  cssEscape: (text: string) => string
  playSfx: (name: SfxName) => void
  save: () => void
  /** 手册内状态变更后重绘故事画面（关闭手册时触发）。 */
  refreshStory: () => void
  bindIn: (container: HTMLElement, selector: string, handler: () => void) => void
}

export class HandbookController {
  private needsRefresh = false
  private revealedDeductionHints = new Set<string>()

  constructor(private readonly ctx: HandbookCtx) {}

  /** 宿主在重开/重玩时重置手册内部状态。 */
  resetState(): void {
    this.needsRefresh = false
    this.revealedDeductionHints = new Set()
  }

  /* ---------------- 可用性 ---------------- */

  private hasCharacters(): boolean {
    return Boolean(this.ctx.story.characters && Object.keys(this.ctx.story.characters).length > 0)
  }

  private hasDocs(): boolean {
    const game = this.ctx.game()
    return game.state.docs.length > 0 && Boolean(this.ctx.story.documents)
  }

  private hasEvidence(): boolean {
    const game = this.ctx.game()
    return game.state.evidence.length > 0 && Boolean(this.ctx.story.evidence) && Boolean(this.ctx.story.deductions)
  }

  private hasPuzzles(): boolean {
    const game = this.ctx.game()
    return Boolean(
      this.ctx.story.puzzles &&
      (game.availablePuzzles().length > 0 || game.state.solvedPuzzles.length > 0),
    )
  }

  available(): boolean {
    const game = this.ctx.game()
    return this.hasCharacters() || this.hasDocs() || this.hasEvidence() || this.hasPuzzles() ||
      Boolean(this.ctx.story.meta.hud?.length) || game.state.inventory.length > 0
  }

  /** 调查手册悬浮标签：固定在画面侧边，打开抽屉；不占页眉，减少对拟态媒介的破坏。 */
  fabHtml(attention = false): string {
    if (!this.available()) return ''
    const label = this.ctx.story.meta.site?.kind === 'news' ? '档案' : '手册'
    return `<button class="handbook-fab" data-action="handbook" title="调查手册（H）" aria-label="调查手册">${label}${attention ? ' ●' : ''}</button>`
  }

  /* ---------------- 教学横幅 ---------------- */

  activeTutorial(hasPuzzle: boolean): 'deduction' | 'puzzle' | 'relationship' | null {
    const game = this.ctx.game()
    const hasUnconfirmedDeduction = game.state.evidence.length > 0 && Object.values(this.ctx.story.deductions ?? {})
      .some((deduction) => !game.state.deductions.includes(deduction.id))
    if (hasPuzzle && !game.hasSeenTutorial('puzzle')) return 'puzzle'
    if (hasUnconfirmedDeduction && !game.hasSeenTutorial('deduction')) return 'deduction'
    if (this.ctx.story.characters && Object.keys(this.ctx.story.characters).length > 0 && !game.hasSeenTutorial('relationship')) return 'relationship'
    return null
  }

  tutorialBanner(kind: 'deduction' | 'puzzle' | 'relationship'): string {
    const content = {
      deduction: ['推理板', '收集到的证据会进入推理板。证据不足时推论不会成型；成型后需要精确勾选支持它的证据，才能解锁新的行动与结局。'],
      puzzle: ['场景谜题', '醒目的谜题行动可以直接尝试；答案来自场景信息，遇到困难可查看渐进提示或返回调查。'],
      relationship: ['人物关系', '你的回应会改变人物的信任与记忆，从而影响证词、秘密、行动或结局。'],
    }[kind]
    return `<aside class="tutorial-banner" data-tutorial="${kind}"><div><strong>${content[0]}</strong><span>${content[1]}</span></div><button class="btn btn-ghost" data-action="dismiss-tutorial">知道了</button></aside>`
  }

  /* ---------------- 抽屉 ---------------- */

  private ensureOverlay(): HTMLElement {
    const existing = this.ctx.root.querySelector<HTMLElement>('.handbook-overlay')
    if (existing) return existing
    const overlay = document.createElement('div')
    overlay.className = 'handbook-overlay'
    overlay.innerHTML = `<button class="handbook-backdrop" data-action="handbook-close" aria-label="关闭调查手册"></button>
      <section class="handbook-panel" role="dialog" aria-modal="true" aria-label="调查手册"></section>`
    this.ctx.root.appendChild(overlay)
    this.ctx.bindIn(overlay, '[data-action="handbook-close"]', () => this.close())
    return overlay
  }

  close(): void {
    if (this.needsRefresh) {
      this.needsRefresh = false
      this.ctx.refreshStory()
      return
    }
    this.ctx.root.querySelector<HTMLElement>('.handbook-overlay')?.remove()
  }

  open(kind: ToolKind = 'hub', backTo: ToolBack = 'handbook', preferredId = ''): void {
    const available: Record<ToolKind, boolean> = {
      hub: this.available(),
      characters: this.hasCharacters(),
      docs: this.hasDocs(),
      evidence: this.hasEvidence(),
      puzzles: this.hasPuzzles(),
    }
    if (!available[kind]) return
    const overlay = this.ensureOverlay()
    const panel = overlay.querySelector<HTMLElement>('.handbook-panel')!
    const backToStory = backTo === 'story'
    const back = backToStory ? () => this.close() : () => this.renderPanel(panel)
    const backLabel = backToStory ? '返回故事' : '返回手册'
    switch (kind) {
      case 'characters':
        this.renderCharacters(panel, () => this.renderPanel(panel), '返回手册')
        break
      case 'docs':
        this.renderDocsList(panel, () => this.renderPanel(panel), '返回手册')
        break
      case 'evidence':
        this.renderEvidenceBoard(panel, back, backLabel)
        break
      case 'puzzles':
        this.renderPuzzles(panel, back, backLabel, '', preferredId)
        break
      default:
        this.renderPanel(panel)
    }
  }

  private renderPanel(panel: HTMLElement): void {
    const { esc } = this.ctx
    const game = this.ctx.game()
    const entries: Array<{ kind: ToolKind; label: string; key: string; available: boolean }> = [
      { kind: 'characters', label: '人物', key: 'C', available: this.hasCharacters() },
      { kind: 'docs', label: '线索夹', key: 'I', available: this.hasDocs() },
      { kind: 'evidence', label: '推理板', key: 'R', available: this.hasEvidence() },
      { kind: 'puzzles', label: '谜题', key: 'P', available: this.hasPuzzles() },
    ]
    panel.innerHTML = `<div class="handbook-panel-content">
      <header class="handbook-head"><strong>调查手册</strong><button class="btn btn-ghost" data-action="handbook-close">关闭</button></header>
      ${this.renderHud()}
      ${game.state.inventory.length > 0 ? `<section class="handbook-inventory"><span class="handbook-inventory-label">持有物品</span>${this.renderInventory(game.state.inventory)}</section>` : ''}
      <div class="handbook-grid">
        ${entries
          .filter((entry) => entry.available)
          .map((entry) => `<button class="handbook-entry" data-handbook-entry="${entry.kind}" title="${entry.label}（${entry.key}）">
            <span class="handbook-entry-key">${entry.key}</span>
            <span class="handbook-entry-label">${esc(entry.label)}</span>
          </button>`).join('')}
      </div>
      <p class="handbook-tip">快捷键：H 手册，C 人物，I 线索夹，R 推理板，P 谜题，Esc 关闭。</p>
    </div>`
    this.ctx.bindIn(panel, '[data-action="handbook-close"]', () => this.close())
    panel.querySelectorAll<HTMLElement>('[data-handbook-entry]').forEach((button) => {
      button.addEventListener('click', () => this.open(button.dataset.handbookEntry as ToolKind, 'handbook'))
    })
  }

  /** 密码谜题面板：确定性答案验证、错误次数和渐进提示。 */
  private renderPuzzles(panel: HTMLElement, back: () => void, backLabel: string, message = '', preferredId = ''): void {
    const { esc } = this.ctx
    const game = this.ctx.game()
    const story = this.ctx.story
    const available = game.availablePuzzles()
    const solved = game.state.solvedPuzzles
      .map((id) => story.puzzles?.[id])
      .filter((puzzle): puzzle is NonNullable<typeof puzzle> => Boolean(puzzle))
    const puzzles = [...available, ...solved.filter((puzzle) => !available.some((item) => item.id === puzzle.id))]
    const active = puzzles.find((puzzle) => puzzle.id === preferredId) ?? puzzles[0]
    const revealedCount = active ? (game.state.puzzleHints[active.id] ?? 0) : 0
    const revealedHints = active?.hints?.slice(0, revealedCount) ?? []
    const isSolved = active ? game.state.solvedPuzzles.includes(active.id) : false
    panel.innerHTML = `<div class="handbook-panel-content">
      <header class="handbook-head"><strong>谜题</strong><span>${puzzles.length} 项</span><button class="btn btn-ghost" data-action="back">${esc(backLabel)}</button></header>
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
    </div>`
    this.ctx.bindIn(panel, '[data-action="back"]', back)
    this.ctx.bindIn(panel, '[data-action="attempt-puzzle"]', () => {
      if (!active) return
      const answer = panel.querySelector<HTMLInputElement>(`[data-puzzle-answer="${this.ctx.cssEscape(active.id)}"]`)?.value ?? ''
      const result = game.attemptPuzzle(active.id, answer)
      this.ctx.save()
      if (result.solved) this.needsRefresh = true
      this.renderPuzzles(
        panel,
        back,
        backLabel,
        result.solved ? '谜题已解开。新的行动可能已经解锁。' : `答案不正确，已尝试 ${result.attempts} 次。`,
        active.id,
      )
    })
    this.ctx.bindIn(panel, '[data-action="puzzle-hint"]', () => {
      if (!active) return
      const result = game.revealPuzzleHint(active.id)
      this.ctx.save()
      this.renderPuzzles(panel, back, backLabel, result.hint ? `已揭示提示 ${result.revealed} / ${result.total}` : '没有更多提示。', active.id)
    })
  }

  /** 人物面板：展示人物说明、当前关系与已揭示/未知秘密。 */
  private renderCharacters(panel: HTMLElement, back: () => void, backLabel: string): void {
    const { esc } = this.ctx
    const game = this.ctx.game()
    const characters = Object.values(this.ctx.story.characters ?? {})
    panel.innerHTML = `<div class="handbook-panel-content">
      <header class="handbook-head"><strong>人物</strong><span>${characters.length} 人</span><button class="btn btn-ghost" data-action="back">${esc(backLabel)}</button></header>
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
    </div>`
    this.ctx.bindIn(panel, '[data-action="back"]', back)
  }

  private canConfirmDeduction(deduction: Deduction): boolean {
    const game = this.ctx.game()
    const owned = new Set(game.state.evidence)
    const required = deduction.requires.all ?? []
    const alternativeGroups = deduction.requires.anyOf ?? []
    return required.every((id) => owned.has(id)) &&
      alternativeGroups.every((group) => group.some((id) => owned.has(id)))
  }

  /** 推理板：证据不足的推论不显示结论文本；勾选必须精确等于支持集。 */
  private renderEvidenceBoard(panel: HTMLElement, back: () => void, backLabel: string, resultMessage = ''): void {
    const { esc } = this.ctx
    const game = this.ctx.game()
    const story = this.ctx.story
    const owned = game.state.evidence
      .map((id) => story.evidence?.[id])
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    const deductions = Object.values(story.deductions ?? {})
    const hasSelectable = deductions.some((deduction) =>
      !game.state.deductions.includes(deduction.id) && this.canConfirmDeduction(deduction))
    panel.innerHTML = `<div class="handbook-panel-content">
      <header class="handbook-head"><strong>推理板</strong><span>${owned.length} 条证据</span><button class="btn btn-ghost" data-action="back">${esc(backLabel)}</button></header>
      <p class="deduction-guide">选择一项已经成型的推论，再精确勾选支持它的证据，最后点击“验证推论”。多选或少选都不会成立；证据不足时继续返回场景调查。</p>
      <h2 class="deduction-heading">推论</h2>
      <div class="deduction-list">${deductions.map((deduction, index) => {
        const confirmed = game.state.deductions.includes(deduction.id)
        const ownedSet = new Set(game.state.evidence)
        const required = deduction.requires.all ?? []
        const alternativeGroups = deduction.requires.anyOf ?? []
        const requiredOwned = required.filter((id) => ownedSet.has(id)).length
        const groupsMet = alternativeGroups.filter((group) => group.some((id) => ownedSet.has(id))).length
        const confirmable = requiredOwned === required.length && groupsMet === alternativeGroups.length
        const showStatement = confirmed || confirmable
        const hintRevealed = this.revealedDeductionHints.has(deduction.id)
        return `<label class="deduction-item ${confirmed ? 'deduction-confirmed' : ''}" data-deduction="${esc(deduction.id)}" data-deduction-can-confirm="${confirmable && !confirmed}">
          <input type="radio" name="deduction" value="${esc(deduction.id)}" ${index === 0 && !confirmed && confirmable ? 'checked' : ''} ${confirmed || !confirmable ? 'disabled' : ''}/>
          <span><strong>${showStatement ? `${esc(deduction.statement)}${confirmed ? ' · 已成立' : ''}` : '尚未成型的推论'}</strong>
            <small data-deduction-progress="${esc(deduction.id)}">${confirmed ? '已成立' : `关键证据 ${requiredOwned}/${required.length}${alternativeGroups.length > 0 ? ` · 替代证据组 ${groupsMet}/${alternativeGroups.length}` : ''}`}</small>
            ${!confirmed && !confirmable && deduction.hint ? (hintRevealed
              ? `<small data-deduction-hint="${esc(deduction.id)}">调查方向：${esc(deduction.hint)}</small>`
              : `<button class="btn btn-ghost docs-btn" data-deduction-hint-btn="${esc(deduction.id)}">调查方向</button>`) : ''}
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
        ${hasSelectable ? '<button class="btn btn-primary" data-action="confirm-deduction">验证推论</button>' : '<p class="handbook-tip">继续调查，收集更多证据后推论才会成型。</p>'}
      </div>
    </div>`
    this.ctx.bindIn(panel, '[data-action="back"]', back)
    panel.querySelectorAll<HTMLElement>('[data-deduction-hint-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.revealedDeductionHints.add(btn.dataset.deductionHintBtn!)
        this.renderEvidenceBoard(panel, back, backLabel)
      })
    })
    this.ctx.bindIn(panel, '[data-action="confirm-deduction"]', () => {
      const deductionId = panel.querySelector<HTMLInputElement>('input[name="deduction"]:checked')?.value
      const selected = [...panel.querySelectorAll<HTMLInputElement>('[data-evidence]:checked')].map((input) => input.value)
      const success = deductionId ? game.confirmDeduction(deductionId, selected) : false
      if (success) {
        this.needsRefresh = true
        this.ctx.save()
      }
      this.renderEvidenceBoard(panel, back, backLabel, success ? '推论成立。新的行动可能已经解锁。' : '证据不足，或勾选证据不能恰好支持该推论。')
    })
  }

  /** 线索夹列表面板 */
  private renderDocsList(panel: HTMLElement, back: () => void, backLabel: string): void {
    this.ctx.playSfx('page')
    const { esc } = this.ctx
    const game = this.ctx.game()
    const story = this.ctx.story
    const owned = game.state.docs
      .map((id) => story.documents?.[id])
      .filter((d): d is NonNullable<typeof d> => Boolean(d))
    panel.innerHTML = `<div class="handbook-panel-content">
      <header class="handbook-head"><strong>线索夹</strong><span>${owned.length} 份</span><button class="btn btn-ghost" data-action="back">${esc(backLabel)}</button></header>
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
    </div>`
    this.ctx.bindIn(panel, '[data-action="back"]', back)
    panel.querySelectorAll<HTMLButtonElement>('[data-doc]').forEach((btn) => {
      btn.addEventListener('click', () => this.renderDocDetail(panel, () => this.renderDocsList(panel, back, backLabel), btn.dataset.doc!))
    })
  }

  /** 单个线索查看面板 */
  private renderDocDetail(panel: HTMLElement, backToList: () => void, docId: string): void {
    this.ctx.playSfx('page')
    const { esc } = this.ctx
    const doc = this.ctx.story.documents?.[docId]
    if (!doc) return
    const game = this.ctx.game()
    panel.innerHTML = `<div class="handbook-panel-content">
      <header class="handbook-head"><strong>线索夹</strong><span>${esc(docKindLabel(doc.kind))}</span><button class="btn btn-ghost" data-action="back">返回列表</button></header>
      <section class="card">
        <div class="block block-${esc(doc.kind ?? 'doc')}">
          <div class="block-head">${esc(doc.title)}</div>
          <div class="block-body">${esc(game.interpolate(doc.text))}</div>
        </div>
      </section>
    </div>`
    this.ctx.bindIn(panel, '[data-action="back"]', backToList)
  }

  /* ---------------- HUD / 道具 ---------------- */

  renderInventory(inventory: string[]): string {
    if (inventory.length === 0) return ''
    const { esc } = this.ctx
    return `<div class="inventory">${inventory
      .map((item) => `<span class="inv-chip">${esc(item)}</span>`)
      .join('')}</div>`
  }

  /** HUD 统计条（meta.hud：好感度/理智值等数值变量；var 可为 #day） */
  renderHud(): string {
    const hud = this.ctx.story.meta.hud
    if (!hud?.length) return ''
    const { esc } = this.ctx
    const game = this.ctx.game()
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
}

/** 文档/块类型 → 中文标签 */
export function docKindLabel(kind?: string): string {
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