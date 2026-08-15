import { describe, expect, it } from 'vitest'
import { makeStory } from './fixtures.js'
import { reviewTransitions } from './transition-review.js'

describe('reviewTransitions', () => {
  it('以紧凑片段返回完整的转场阅读单位', () => {
    const story = makeStory()
    story.nodes.start.text = `前文${'很长的内容'.repeat(80)}最后一句。`
    story.nodes.start.choices[0].response = '你握紧剑，勇气变成 {courage}。'

    const report = reviewTransitions(story, { nodeIds: ['start'], limit: 1 })

    expect(report.summary).toMatchObject({ totalEdges: 2, returned: 1, responseEdges: 1 })
    expect(report.items[0]).toMatchObject({
      sourceNodeId: 'start', choiceIndex: 0, label: '拿剑', targetNodeId: 'armed',
      response: '你握紧剑，勇气变成 {courage}。',
    })
    expect(report.items[0].sourceTail.length).toBeLessThanOrEqual(160)
    expect(report.items[0].targetOpening.length).toBeLessThanOrEqual(200)
    expect(report.nextCursor).toBe(1)
  })

  it('标记汇流缺承接、自环与断链，并可只返回风险边', () => {
    const story = makeStory()
    story.nodes.start.choices = [
      { label: '坦白', target: 'armed', response: '你把真话说完。' },
      { label: '沉默', target: 'armed' },
      { label: '原地等候', target: 'start' },
      { label: '走向空房', target: 'missing' },
    ]

    const report = reviewTransitions(story, { nodeIds: ['start'], onlyRisks: true })

    expect(report.items.map((item) => [item.label, item.risks])).toEqual([
      ['沉默', ['converging_choices_without_response']],
      ['原地等候', ['self_loop_without_response']],
      ['走向空房', ['missing_target']],
    ])
    expect(report.summary).toMatchObject({ totalEdges: 4, candidateEdges: 3, riskyEdges: 3 })
  })

  it('标记只是重复目标节点开头的机械 response', () => {
    const story = makeStory()
    story.nodes.start.choices = [
      { label: '走进房间', target: 'armed', response: '房间里的灯忽然亮了。' },
    ]
    story.nodes.armed.text = '房间里的灯忽然亮了。桌上放着一封没有署名的信。'

    const report = reviewTransitions(story, { onlyRisks: true })

    expect(report.items).toHaveLength(1)
    expect(report.items[0].risks).toContain('response_repeats_target_opening')
  })

  it('保守标记与目标开头高度重合但并非逐字相同的 response', () => {
    const story = makeStory()
    story.nodes.start.choices = [
      { label: '走进展厅', target: 'armed', response: '标本展厅只剩一盏灯。' },
    ]
    story.nodes.armed.text = '标本展厅的灯只剩一盏。闻舟站在第三柜前。'

    expect(reviewTransitions(story, { onlyRisks: true }).items[0].risks)
      .toContain('response_repeats_target_opening')
  })
})
