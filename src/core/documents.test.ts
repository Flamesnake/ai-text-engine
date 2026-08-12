import { describe, expect, it } from 'vitest'
import type { Story } from './types.js'
import { Game } from './engine.js'
import { validate } from './validate.js'
import { makeStory } from './fixtures.js'

/** 带文档/线索的测试剧情 */
function makeStoryWithDocs(): Story {
  const story = makeStory()
  story.documents = {
    d_rules: {
      id: 'd_rules',
      title: '游客守则（节选）',
      kind: 'rules',
      text: '1. 兔子不会发出笑声。\n2. 若听见笑声，请撕下地图虚线处。',
    },
    d_note: {
      id: 'd_note',
      title: '捡到的纸条',
      kind: 'note',
      text: '字迹很潦草：「别相信员工手册。」',
    },
  }
  // start 节点：选择「捡起守则」获得线索 d_rules
  story.nodes.start.choices = [
    {
      label: '捡起地上的守则',
      target: 'read_rules',
      effects: { gainDocs: ['d_rules'] },
    },
    { label: '捡起纸条', target: 'read_note', effects: { gainDocs: ['d_note'] } },
  ]
  story.nodes.read_rules = {
    id: 'read_rules',
    text: '你读完了守则。',
    choices: [],
    ending: { id: 'e_good', title: '好结局', kind: 'good' },
  }
  story.nodes.read_note = {
    id: 'read_note',
    text: '纸条很旧。',
    choices: [],
    ending: { id: 'e_good', title: '好结局', kind: 'good' },
  }
  // 原 fixture 的节点已不再被引用，删除避免不可达报错；结局表同步清理
  for (const id of ['armed', 'unarmed', 'fight', 'flee', 'beg']) {
    delete story.nodes[id]
  }
  delete story.endings.e_bad
  delete story.endings.e_true
  story.nodes.start.text = '你站在动物园入口，地上散落着几张纸。'
  return story
}

describe('文档/线索系统', () => {
  it('gainDocs 效果把线索加入 docs', () => {
    const g = new Game(makeStoryWithDocs())
    expect(g.state.docs).toEqual([])
    g.choose(0) // 捡守则
    expect(g.state.docs).toEqual(['d_rules'])
    expect(g.state.inventory).toEqual([]) // 线索不进道具栏
  })

  it('#docs 条件用于成就与选项', () => {
    const story = makeStoryWithDocs()
    story.achievements = [
      {
        id: 'collector',
        title: '收集者',
        description: '获得守则',
        when: { op: 'eq', var: '#docs', value: 'd_rules' },
      },
    ]
    const g = new Game(story)
    g.choose(0) // 捡守则
    expect(g.state.achievements).toContain('collector')
  })

  it('存档恢复保留 docs', () => {
    const g = new Game(makeStoryWithDocs())
    g.choose(1) // 捡纸条
    const save = g.toSave()
    expect(save.docs).toEqual(['d_note'])
    const restored = new Game(makeStoryWithDocs(), save)
    expect(restored.state.docs).toEqual(['d_note'])
  })

  it('restart 清空 docs', () => {
    const g = new Game(makeStoryWithDocs())
    g.choose(0)
    expect(g.state.docs.length).toBe(1)
    g.restart()
    expect(g.state.docs).toEqual([])
  })

  it('validate 检查 gainDocs 引用与文档完整性', () => {
    const story = makeStoryWithDocs()
    // 引用不存在的文档
    story.nodes.start.choices[0].effects = { gainDocs: ['d_ghost'] }
    let problems = validate(story)
    expect(problems.join('\n')).toContain('不存在的文档 "d_ghost"')

    // 文档缺 title
    const doc = story.documents!.d_rules as unknown as { title?: string }
    delete doc.title
    problems = validate(story)
    expect(problems.join('\n')).toContain('文档 "d_rules" 缺少 title')
  })

  it('validate 通过合法文档剧情', () => {
    expect(validate(makeStoryWithDocs())).toEqual([])
  })

  it('blocks 文本块校验：title 块缺 title 报错', () => {
    const story = makeStory()
    story.nodes.start.blocks = [{ type: 'title', text: '没有标题字段' }]
    story.nodes.start.text = ''
    const problems = validate(story)
    expect(problems.join('\n')).toContain('title 文本块缺少 title 字段')
  })
})
