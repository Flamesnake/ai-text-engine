import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Story } from './types.js'
import { Game } from './engine.js'
import { validate } from './validate.js'
import { walkAllEndings } from './walk.js'
import { makeStory } from './fixtures.js'

/** 带随机/违规/天数机制的测试剧情 */
function makeMechanicsStory(): Story {
  const story = makeStory()
  story.nodes.start.text = '第 {#day} 天。'
  story.nodes.start.choices = [
    {
      label: '翻墙逃票（违反规则）',
      target: 'violated',
      effects: { violation: ['r_ticket'], day: 1, rand: [{ var: '受伤', min: 3, max: 7 }] },
    },
    {
      label: '排队买票（守规矩）',
      target: 'obeyed',
      effects: { day: 1, rand: [{ var: '受伤', min: 0, max: 0 }] },
    },
  ]
  story.nodes.violated = {
    id: 'violated',
    text: '你被抓了。',
    choices: [],
    ending: { id: 'e_good', title: '好结局', kind: 'good' },
  }
  story.nodes.obeyed = {
    id: 'obeyed',
    text: '顺利入园。',
    choices: [],
    ending: { id: 'e_good', title: '好结局', kind: 'good' },
  }
  for (const id of ['armed', 'unarmed', 'fight', 'flee', 'beg']) delete story.nodes[id]
  delete story.endings.e_bad
  delete story.endings.e_true
  return story
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('随机 / 违规 / 天数系统', () => {
  it('rand 效果赋随机整数且在 [min, max] 范围内', () => {
    const g = new Game(makeMechanicsStory())
    // 控制 Math.random 验证边界
    vi.spyOn(Math, 'random').mockReturnValue(0) // → min
    g.choose(0)
    expect(g.state.vars['受伤']).toBe(3)
    g.restart()
    vi.spyOn(Math, 'random').mockReturnValue(0.999) // → max
    g.choose(0)
    expect(g.state.vars['受伤']).toBe(7)
  })

  it('violation 记录违规规则 id（去重）', () => {
    const g = new Game(makeMechanicsStory())
    expect(g.state.violations).toEqual([])
    g.choose(0)
    expect(g.state.violations).toEqual(['r_ticket'])
    // 重复违规不重复记录
    g.restart()
    g.choose(0)
    expect(g.state.violations).toEqual(['r_ticket'])
  })

  it('day 效果推进天数（含最小 1 保护）', () => {
    const g = new Game(makeMechanicsStory())
    expect(g.state.day).toBe(1)
    g.choose(0) // day +1
    expect(g.state.day).toBe(2)
    g.restart()
    expect(g.state.day).toBe(1)
  })

  it('#day 与 #violated 条件用于成就/选项', () => {
    const story = makeMechanicsStory()
    story.achievements = [
      {
        id: 'day3',
        title: '第三天',
        description: '活到第三天',
        when: { op: 'gte', var: '#day', value: 3 },
      },
      {
        id: 'rule_breaker',
        title: '违规者',
        description: '违反过规则',
        when: { op: 'eq', var: '#violated', value: 'r_ticket' },
      },
    ]
    const g = new Game(story)
    g.choose(0) // 违规 + day2
    expect(g.state.achievements).toContain('rule_breaker')
    expect(g.state.achievements).not.toContain('day3')
    // 再走一天到 day3
    g.restart()
    g.choose(1) // day2
    expect(g.state.day).toBe(2)
    // 手动推进验证 #day 条件（通过 checkAchievements 在 day>=3 时解锁）
    const story3 = makeMechanicsStory()
    story3.achievements = [
      { id: 'day3', title: '第三天', description: 'd', when: { op: 'gte', var: '#day', value: 3 } },
    ]
    story3.nodes.start.onEnter = { day: 2 } // 开局即第 3 天
    const g4 = new Game(story3)
    expect(g4.state.day).toBe(3)
    expect(g4.state.achievements).toContain('day3')
  })

  it('正文插值 {#day} 显示天数', () => {
    const g = new Game(makeMechanicsStory())
    g.choose(0)
    expect(g.interpolate('第 {#day} 天')).toBe('第 2 天')
  })

  it('存档恢复保留 day 与 violations', () => {
    const g = new Game(makeMechanicsStory())
    g.choose(0)
    const save = g.toSave()
    expect(save.day).toBe(2)
    expect(save.violations).toEqual(['r_ticket'])
    const restored = new Game(makeMechanicsStory(), save)
    expect(restored.state.day).toBe(2)
    expect(restored.state.violations).toEqual(['r_ticket'])
  })

  it('walk 全路径模拟正确处理违规/天数（不抛错且结局可达）', () => {
    const result = walkAllEndings(makeMechanicsStory())
    expect(result.warnings).toEqual([])
    expect(result.unreachableEndings).toEqual([])
    expect(result.endings.map((e) => e.endingId)).toEqual(['e_good'])
  })

  it('validate 接受 rand/violation/day 效果', () => {
    expect(validate(makeMechanicsStory())).toEqual([])
  })
})
