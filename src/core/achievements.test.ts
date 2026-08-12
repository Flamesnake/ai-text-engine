import { describe, expect, it } from 'vitest'
import type { Story } from './types.js'
import { Game } from './engine.js'
import { validate } from './validate.js'
import { makeStory } from './fixtures.js'

function makeStoryWithAchievements(): Story {
  const story = makeStory()
  story.achievements = [
    {
      id: 'first_step',
      title: '第一步',
      description: '走出第一步',
      when: { op: 'gte', var: '#steps', value: 2 },
    },
    {
      id: 'sword',
      title: '持剑者',
      description: '获得剑',
      icon: '⚔️',
      when: { op: 'has', var: '剑' },
    },
    {
      id: 'brave',
      title: '勇者',
      description: '勇气达到 8',
      when: { op: 'gte', var: 'courage', value: 8 },
    },
    {
      id: 'ending_good',
      title: '好结局',
      description: '抵达好结局',
      when: { op: 'eq', var: '#ending', value: 'e_good' },
    },
    {
      id: 'secret_visitor',
      title: '神秘访客',
      description: '到过空手路线',
      hidden: true,
      when: { op: 'eq', var: '#visited', value: 'unarmed' },
    },
  ]
  return story
}

describe('成就系统', () => {
  it('按步数与道具/变量条件逐步解锁', () => {
    const g = new Game(makeStoryWithAchievements())
    expect(g.state.achievements).toEqual([]) // 开局 1 步，无成就

    const unlocked = g.checkAchievements()
    expect(unlocked).toHaveLength(0) // 未推进前无新解锁

    g.choose(0) // 拿剑 → armed：steps=2、gain 剑、courage=8
    expect(g.state.achievements.sort()).toEqual(['brave', 'first_step', 'sword'])
    // checkAchievements 再次调用不再重复解锁
    expect(g.checkAchievements()).toHaveLength(0)
  })

  it('#ending 条件在抵达结局时解锁', () => {
    const g = new Game(makeStoryWithAchievements())
    g.choose(0)
    g.choose(0) // 战斗 → 好结局
    expect(g.state.achievements).toContain('ending_good')
  })

  it('#visited 条件解锁隐藏成就', () => {
    const g = new Game(makeStoryWithAchievements())
    g.choose(1) // 空手 → unarmed
    expect(g.state.achievements).toContain('secret_visitor')
    expect(g.state.visited).toContain('unarmed')
  })

  it('存档恢复后成就保留且不重复解锁', () => {
    const g = new Game(makeStoryWithAchievements())
    g.choose(0)
    const save = g.toSave()
    expect(save.achievements.length).toBeGreaterThan(0)

    const restored = new Game(makeStoryWithAchievements(), save)
    expect(restored.state.achievements).toEqual(g.state.achievements)
    expect(restored.checkAchievements()).toHaveLength(0) // 已解锁的不再触发
  })

  it('restart 清空成就', () => {
    const g = new Game(makeStoryWithAchievements())
    g.choose(0)
    expect(g.state.achievements.length).toBeGreaterThan(0)
    g.restart()
    expect(g.state.achievements).toEqual([])
  })

  it('validate 检查成就定义：id 重复与未写入变量', () => {
    const story = makeStoryWithAchievements()
    story.achievements!.push({
      id: 'sword', // 重复 id
      title: '重复',
      description: 'd',
      when: { op: 'gt', var: 'ghost_var', value: 1 }, // 未写入变量
    })
    const problems = validate(story)
    const all = problems.join('\n')
    expect(all).toContain('成就 id 重复："sword"')
    expect(all).toContain('"ghost_var"')
  })

  it('validate 通过合法成就定义（特殊变量不误报未写入）', () => {
    expect(validate(makeStoryWithAchievements())).toEqual([])
  })
})
