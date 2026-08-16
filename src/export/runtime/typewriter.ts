/**
 * 逐字输出控制器（P2-2 拆分）：持有活动元素与定时器集合，
 * 提供 start / finish / clear / init 全流程。原有行为与 runtime.ts 闭包版完全一致。
 */

const TICK_MS = 24
/** 防止超长文本逐字过慢：每 tick 至少推进的字符数 */
const MIN_CHARS_PER_TICK = 250

export class TypewriterController {
  private active = new Set<HTMLElement>()
  private timers = new Set<ReturnType<typeof setTimeout>>()
  private readonly prefersReducedMotion: () => boolean

  constructor(options?: { prefersReducedMotion?: () => boolean }) {
    this.prefersReducedMotion = options?.prefersReducedMotion ?? (() =>
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }

  get activeCount(): number {
    return this.active.size
  }

  /** 清空所有逐字输出定时器与状态，用于节点切换和实例销毁。 */
  clear(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    for (const element of this.active) element.classList.remove('text-typing')
    this.active.clear()
  }

  /** 立即补全单个元素。 */
  finish(element: HTMLElement): void {
    const full = element.dataset.textRevealFull
    if (full !== undefined) element.textContent = full
    element.classList.remove('text-typing')
    this.active.delete(element)
  }

  /** 立即补全所有进行中的逐字输出（Enter 快捷键）。 */
  finishAll(): void {
    for (const element of [...this.active]) this.finish(element)
  }

  /** 逐字输出：点击正文或按 Enter 可立即补全；减弱动态偏好下直接显示全文。 */
  start(element: HTMLElement): void {
    const full = element.textContent ?? ''
    if (!full) return
    if (this.prefersReducedMotion()) return

    element.dataset.textRevealFull = full
    element.textContent = ''
    element.classList.add('text-typing')
    this.active.add(element)
    const characters = Array.from(full)
    const charsPerTick = Math.max(1, Math.ceil(characters.length / MIN_CHARS_PER_TICK))
    let index = 0

    const step = (): void => {
      if (!this.active.has(element)) return
      index = Math.min(characters.length, index + charsPerTick)
      element.textContent = characters.slice(0, index).join('')
      if (index >= characters.length) {
        this.finish(element)
        return
      }
      const timer = setTimeout(step, TICK_MS)
      this.timers.add(timer)
    }
    const firstTimer = setTimeout(step, TICK_MS)
    this.timers.add(firstTimer)
  }

  /** 把元素绑定为「点击即补全」（每个元素只绑一次）。 */
  bindRevealOnClick(element: HTMLElement): void {
    if (element.dataset.typewriterBound) return
    element.dataset.typewriterBound = '1'
    element.addEventListener('click', () => this.finish(element))
  }

  /** 启动当前画面里所有标记为逐字输出的正文元素。 */
  init(root: HTMLElement): void {
    this.clear()
    root
      .querySelectorAll<HTMLElement>('[data-text-reveal="typewriter"], [data-text-reveal="terminal"]')
      .forEach((element) => this.start(element))
    for (const element of this.active) this.bindRevealOnClick(element)
  }
}