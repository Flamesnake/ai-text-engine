import type { Achievement, Choice, EndingMeta, GameState, Story, StoryNode } from './types.js'
import { applyEffects } from './effects.js'
import { evalCondition, type ConditionContext } from './conditions.js'

/**
 * Game：文字冒险状态机（纯逻辑，不依赖 DOM）。
 *
 * - 维护状态：当前节点 / 历史 / 变量 / 道具 / 旗标 / 结局；
 * - 选项条件过滤（when）；
 * - 效果应用（选项 effects 与节点 onEnter）；
 * - 正文变量插值（{var} / {#inventory}）；
 * - 存档快照生成与恢复。
 */
export class Game {
  private readonly story: Story
  private st: GameState

  constructor(story: Story, save?: GameState | null) {
    this.story = story
    if (save) {
      this.assertNode(save.nodeId)
      this.st = {
        nodeId: save.nodeId,
        history: [...save.history],
        visited: [...(save.visited ?? [])],
        vars: { ...save.vars },
        inventory: [...save.inventory],
        docs: [...(save.docs ?? [])],
        violations: [...(save.violations ?? [])],
        day: typeof save.day === 'number' ? save.day : 1,
        achievements: [...(save.achievements ?? [])],
        endingId: save.endingId ?? null,
        updatedAt: save.updatedAt ?? Date.now(),
      }
    } else {
      this.st = {
        nodeId: story.start,
        history: [story.start],
        visited: [story.start],
        vars: {},
        inventory: [],
        docs: [],
        violations: [],
        day: 1,
        achievements: [],
        endingId: null,
        updatedAt: Date.now(),
      }
      // 新游戏：应用起始节点的 onEnter
      this.applyOnEnter(story.start)
      this.checkAchievements()
    }
  }

  /* ------------------------------ getters ------------------------------ */

  get state(): Readonly<GameState> {
    return this.st
  }

  get currentNode(): StoryNode {
    return this.story.nodes[this.st.nodeId]
  }

  get isEnding(): boolean {
    return this.currentNode.choices.length === 0 && this.currentNode.ending !== undefined
  }

  get endingMeta(): EndingMeta | null {
    return this.st.endingId ? (this.story.endings[this.st.endingId] ?? null) : null
  }

  get stepCount(): number {
    return this.st.history.length
  }

  /** 应用条件过滤后当前可见的选项 */
  visibleChoices(): Choice[] {
    return this.currentNode.choices.filter((c) =>
      evalCondition(c.when, { vars: this.st.vars, inventory: this.st.inventory }),
    )
  }

  /* ------------------------------ 动作 ------------------------------ */

  /** 选择第 index 个可见选项并推进 */
  choose(index: number): void {
    const choices = this.visibleChoices()
    if (index < 0 || index >= choices.length) {
      throw new RangeError(`选项索引越界：${index}（可见选项 0..${choices.length - 1}）`)
    }
    const choice = choices[index]
    const target = {
      vars: this.st.vars,
      inventory: this.st.inventory,
      docs: this.st.docs,
      day: this.st.day,
      violations: this.st.violations,
    }
    applyEffects(choice.effects, target)
    this.st.day = target.day
    this.enter(choice.target)
  }

  /** 回到起始节点（重开即清空一切） */
  restart(): void {
    this.st = {
      nodeId: this.story.start,
      history: [this.story.start],
      visited: [this.story.start],
      vars: {},
      inventory: [],
      docs: [],
      violations: [],
      day: 1,
      achievements: [],
      endingId: null,
      updatedAt: Date.now(),
    }
    this.applyOnEnter(this.story.start)
    this.checkAchievements()
  }

  /* ------------------------------ 文本 ------------------------------ */

  /** 正文插值：{varName} → 变量值；{#inventory} → 道具列表 */
  interpolate(text: string): string {
    return text.replace(/\{([^}]+)\}/g, (match, key: string) => {
      const k = key.trim()
      if (k === '#inventory') {
        return this.st.inventory.length > 0 ? this.st.inventory.join('、') : '（什么都没有）'
      }
      if (k === '#history') {
        return String(this.st.history.length)
      }
      if (k === '#day') {
        return String(this.st.day)
      }
      const v = this.st.vars[k]
      return v === undefined ? match : String(v)
    })
  }

  /* ------------------------------ 存档 ------------------------------ */

  toSave(): GameState {
    return {
      nodeId: this.st.nodeId,
      history: [...this.st.history],
      visited: [...this.st.visited],
      vars: { ...this.st.vars },
      inventory: [...this.st.inventory],
      docs: [...this.st.docs],
      violations: [...this.st.violations],
      day: this.st.day,
      achievements: [...this.st.achievements],
      endingId: this.st.endingId,
      updatedAt: Date.now(),
    }
  }

  /* ------------------------------ 内部 ------------------------------ */

  private enter(nodeId: string): void {
    this.assertNode(nodeId)
    this.st.nodeId = nodeId
    this.st.history.push(nodeId)
    if (!this.st.visited.includes(nodeId)) this.st.visited.push(nodeId)
    this.applyOnEnter(nodeId)
    const node = this.currentNode
    this.st.endingId = node.ending ? node.ending.id : null
    this.checkAchievements()
  }

  /** 评估所有未解锁成就，满足条件即解锁（返回本次新解锁列表） */
  checkAchievements(): Achievement[] {
    const unlocked: Achievement[] = []
    if (!this.story.achievements?.length) return unlocked
    for (const ach of this.story.achievements) {
      if (this.st.achievements.includes(ach.id)) continue
      if (evalCondition(ach.when, this.achievementContext())) {
        this.st.achievements.push(ach.id)
        unlocked.push(ach)
      }
    }
    return unlocked
  }

  private achievementContext(): ConditionContext {
    return {
      vars: this.st.vars,
      inventory: this.st.inventory,
      steps: this.st.history.length,
      endingId: this.st.endingId,
      visited: this.st.visited,
      docs: this.st.docs,
      day: this.st.day,
      violations: this.st.violations,
    }
  }

  private applyOnEnter(nodeId: string): void {
    const node = this.story.nodes[nodeId]
    if (node?.onEnter) {
      const target = {
        vars: this.st.vars,
        inventory: this.st.inventory,
        docs: this.st.docs,
        day: this.st.day,
        violations: this.st.violations,
      }
      applyEffects(node.onEnter, target)
      this.st.day = target.day
    }
  }

  private assertNode(nodeId: string): void {
    if (!this.story.nodes[nodeId]) {
      throw new Error(`剧情数据错误：引用不存在的节点 "${nodeId}"`)
    }
  }
}
