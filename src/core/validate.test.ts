import { describe, expect, it } from 'vitest'
import type { Story } from './types.js'
import { validate, validateExperience } from './validate.js'
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

describe('validateExperience 非阻断体验校验', () => {
  it('提示缺少目标、推论方向、谜题场景绑定和结案后果文案', () => {
    const story = makeStory()
    story.evidence = {
      clue: { id: 'clue', title: '证据', description: '描述' },
    }
    story.deductions = {
      theory: { id: 'theory', statement: '待验证命题', requires: { all: ['clue'] } },
    }
    story.puzzles = {
      safe: { id: 'safe', title: '保险箱', prompt: '密码', kind: 'code', solution: '1234' },
    }
    story.nodes.start.choices.push(
      { label: '调查走廊', target: 'armed' },
      { label: '认定这是意外', target: 'flee' },
    )

    const warnings = validateExperience(story).join('\n')
    expect(warnings).toContain('节点 "start" 有 4 个可选行动但没有 objective')
    expect(warnings).toContain('推论 "theory" 缺少 hint')
    expect(warnings).toContain('谜题 "safe" 没有放置到任何节点')
    expect(warnings).toContain('选项「逃跑」直接进入坏结局')
    expect(validate(story)).toEqual([])
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

  it('分支汇合节点不会因其他路径的访问而被误判循环（访问计数按路径独立）', () => {
    const story: Story = {
      meta: { title: '菱形图' },
      start: 'start',
      endings: { e_end: { id: 'e_end', title: '终', kind: 'good' } },
      nodes: {
        start: {
          id: 'start',
          text: 't',
          choices: [
            { label: '左路', target: 'join' },
            { label: '右路', target: 'join' },
          ],
        },
        join: {
          id: 'join',
          text: '汇合',
          choices: [{ label: '去终点', target: 'end' }],
        },
        end: {
          id: 'end',
          text: '终',
          choices: [],
          ending: { id: 'e_end', title: '终', kind: 'good' },
        },
      },
    }
    // maxNodeVisits=1：共享计数的旧实现会在第二条路径进入 join 时误剪枝
    const result = walkAllEndings(story, { maxNodeVisits: 1 })
    expect(result.warnings).toEqual([])
    const end = result.endings.find((e) => e.endingId === 'e_end')!
    expect(end.paths).toBe(1)
  })

  it('调查中心的无状态往返会按状态剪枝，不产生路径组合爆炸', () => {
    const story: Story = {
      meta: { title: '调查中心' },
      start: 'hub',
      endings: { e_end: { id: 'e_end', title: '终', kind: 'good' } },
      nodes: {
        hub: {
          id: 'hub', text: '大厅',
          choices: [
            { label: '去书房', target: 'study' },
            { label: '结案', target: 'end' },
          ],
        },
        study: {
          id: 'study', text: '书房',
          choices: [{ label: '返回大厅', target: 'hub' }],
        },
        end: {
          id: 'end', text: '终', choices: [],
          ending: { id: 'e_end', title: '终', kind: 'good' },
        },
      },
    }

    const result = walkAllEndings(story)
    expect(result.unreachableEndings).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.nodesVisited).toBeLessThan(10)
  })

  it('rand 效果按注入随机源取确定值，结果可复现', () => {
    const story: Story = {
      meta: { title: '随机分支' },
      start: 'start',
      endings: {
        e_low: { id: 'e_low', title: '低', kind: 'bad' },
        e_high: { id: 'e_high', title: '高', kind: 'good' },
      },
      nodes: {
        start: {
          id: 'start',
          text: 't',
          onEnter: { rand: [{ var: 'roll', min: 1, max: 10 }] },
          choices: [
            { label: '走高', target: 'high', when: { op: 'gte', var: 'roll', value: 5 } },
            { label: '走低', target: 'low', when: { op: 'lt', var: 'roll', value: 5 } },
          ],
        },
        high: { id: 'high', text: 'h', choices: [], ending: { id: 'e_high', title: '高', kind: 'good' } },
        low: { id: 'low', text: 'l', choices: [], ending: { id: 'e_low', title: '低', kind: 'bad' } },
      },
    }
    // rand()=0 → roll=1 → 低路径；rand()≈1 → roll=10 → 高路径
    expect(walkAllEndings(story, { rand: () => 0 }).endings.map((e) => e.endingId)).toEqual(['e_low'])
    expect(walkAllEndings(story, { rand: () => 0.999 }).endings.map((e) => e.endingId)).toEqual(['e_high'])
    // 默认随机源固定为中间值，两次调用结果一致（不再依赖真实 Math.random）
    const a = walkAllEndings(story)
    const b = walkAllEndings(story)
    expect(a).toEqual(b)
    expect(a.endings.map((e) => e.endingId)).toEqual(['e_high']) // roll = floor(0.5*10)+1 = 6 ≥ 5
  })

  it('walk 模拟选项的 #day/#docs/#violated 条件（与 Game 行为一致）', () => {
    const story: Story = {
      meta: { title: '条件选项模拟' },
      start: 'start',
      endings: { e_end: { id: 'e_end', title: '终', kind: 'good' } },
      documents: { doc_rule: { id: 'doc_rule', title: '守则', text: '…' } },
      nodes: {
        start: {
          id: 'start',
          text: 't',
          choices: [
            { label: '等两天', target: 'later', effects: { day: 2 } },
            { label: '拿守则', target: 'with_doc', effects: { gainDocs: ['doc_rule'] } },
            { label: '回望起点', target: 'end', when: { op: 'eq', var: '#visited', value: 'start' } },
          ],
        },
        later: {
          id: 'later',
          text: '第 {#day} 天',
          choices: [{ label: '第三天行动', target: 'end', when: { op: 'gte', var: '#day', value: 3 } }],
        },
        with_doc: {
          id: 'with_doc',
          text: '有守则',
          choices: [{ label: '读守则', target: 'end', when: { op: 'eq', var: '#docs', value: 'doc_rule' } }],
        },
        end: {
          id: 'end',
          text: '终',
          choices: [],
          ending: { id: 'e_end', title: '终', kind: 'good' },
        },
      },
    }
    const result = walkAllEndings(story)
    expect(result.warnings).toEqual([])
    expect(result.unreachableEndings).toEqual([])
    const end = result.endings.find((e) => e.endingId === 'e_end')!
    // start→end（#visited）、start→later→end（#day）、start→with_doc→end（#docs）三条路径
    expect(end.paths).toBe(3)
    expect(end.minSteps).toBe(2)
  })
})
