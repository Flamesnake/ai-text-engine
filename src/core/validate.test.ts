import { describe, expect, it } from 'vitest'
import type { Story } from './types.js'
import { validate } from './validate.js'
import { walkAllEndings } from './walk.js'
import { makeStory } from './fixtures.js'

describe('validate 静态校验', () => {
  it('合法剧情返回空问题列表', () => {
    expect(validate(makeStory())).toEqual([])
  })

  it('发现断链 / 悬空结局 / 语义冲突 / 孤儿结局 / 不可达节点', () => {
    const broken: Story = {
      meta: { title: '坏剧情' },
      start: 'start',
      endings: {
        e_ghost: { id: 'e_ghost', title: '孤儿结局', kind: 'bad' },
      },
      nodes: {
        start: {
          id: 'start',
          text: 't',
          choices: [{ label: '去死胡同', target: 'ghost' }],
        },
        lonely: { id: 'lonely', text: '不可达', choices: [] },
        dangling: { id: 'dangling', text: '悬空结局', choices: [] },
        conflicted: {
          id: 'conflicted',
          text: '冲突',
          choices: [{ label: 'x', target: 'lonely' }],
          ending: { id: 'e_x', title: '冲突结局', kind: 'bad' },
        },
      },
    }
    const problems = validate(broken)
    const all = problems.join('\n')
    expect(all).toContain('指向不存在的节点 "ghost"')
    expect(all).toContain('没有选项也没有 ending 元数据')
    expect(all).toContain('既有选项又带 ending 元数据')
    expect(all).toContain('结局 "e_ghost" 已登记但没有任何节点使用它')
    expect(all).toContain('节点 "lonely" 不可达')
  })

  it('发现条件引用了从未被写入的变量（疑似拼写错误）', () => {
    const story: Story = {
      meta: { title: '拼写错误' },
      start: 'start',
      endings: { e_1: { id: 'e_1', title: '终', kind: 'bad' } },
      nodes: {
        start: {
          id: 'start',
          text: '正文引用 {courag}。', // 拼错：实际写入的是 courage
          choices: [
            {
              label: '试试',
              target: 'end',
              when: { op: 'gte', var: 'courag', value: 3 }, // 拼错
              effects: { set: { courage: 5 } }, // 正确拼写
            },
          ],
        },
        end: {
          id: 'end',
          text: '终',
          choices: [],
          ending: { id: 'e_1', title: '终', kind: 'bad' },
        },
      },
    }
    const problems = validate(story)
    const all = problems.join('\n')
    expect(all).toContain('"courag"')
    expect(all).not.toContain('"courage"')
  })
})

describe('walkAllEndings 全路径模拟', () => {
  it('统计 3 个结局全部可达及最短步数', () => {
    const result = walkAllEndings(makeStory())
    expect(result.unreachableEndings).toEqual([])
    expect(result.warnings).toEqual([])
    const ids = result.endings.map((e) => e.endingId).sort()
    expect(ids).toEqual(['e_bad', 'e_good', 'e_true'])
    const good = result.endings.find((e) => e.endingId === 'e_good')!
    // 好结局：start→armed→fight = 3 步；start→unarmed→fight = 3 步
    expect(good.minSteps).toBe(3)
    expect(good.paths).toBeGreaterThanOrEqual(2)
  })

  it('条件分支被正确模拟（低勇气看不到战斗选项）', () => {
    const result = walkAllEndings(makeStory())
    const trueEnd = result.endings.find((e) => e.endingId === 'e_true')!
    expect(trueEnd.minSteps).toBe(3) // start→unarmed→beg
    const badEnd = result.endings.find((e) => e.endingId === 'e_bad')!
    expect(badEnd.minSteps).toBe(3) // start→armed→flee
  })

  it('未登记的结局出现在 unreachableEndings', () => {
    const story = makeStory()
    story.endings.e_fake = { id: 'e_fake', title: '不存在', kind: 'hidden' }
    const result = walkAllEndings(story)
    expect(result.unreachableEndings).toContain('e_fake')
  })
})
