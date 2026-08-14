import { describe, expect, it } from 'vitest'
import { evaluateStory } from './evaluate.js'
import { makeStory } from './fixtures.js'

describe('evaluateStory 作品评估', () => {
  it('返回结构、互动、机制、演出与 walk 的中立指标', () => {
    const story = makeStory()
    story.nodes.armed.sfx = 'heartbeat'
    story.nodes.armed.fx = [{ name: 'shake', intensity: 0.4 }]
    const report = evaluateStory(story)

    expect(report.summary).toMatchObject({ nodes: 6, endings: 3, choices: 6 })
    expect(report.interaction.effectfulChoices).toBe(2)
    expect(report.interaction.conditionalChoices).toBe(1)
    expect(report.performance.walk.unreachableEndings).toEqual([])
    expect(report.presentation.sfxNodes).toBe(1)
    expect(report.presentation.fxNodes).toBe(1)
  })

  it('统计富文本片段、条件揭示与样式使用', () => {
    const story = makeStory()
    story.nodes.start.blocks = [{
      type: 'para', text: '纯文本回退',
      segments: [
        { text: '普通' },
        { text: '血字', style: 'blood' },
        { text: '真相', style: 'redacted', revealWhen: { op: 'eq', var: 'flag', value: true } },
      ],
    }]

    const report = evaluateStory(story)
    expect(report.presentation.segmentNodes).toBe(1)
    expect(report.presentation.segments).toBe(3)
    expect(report.presentation.conditionalSegments).toBe(1)
    expect(report.presentation.segmentStyleUsage).toEqual([
      { name: 'blood', count: 1 },
      { name: 'redacted', count: 1 },
    ])
  })

  it('指出连续单选走廊和重复导航，但不输出总分', () => {
    const story = makeStory()
    story.nodes.start.choices = [{ label: '继续', target: 'armed' }]
    story.nodes.armed.choices = [{ label: '继续', target: 'unarmed' }]
    story.nodes.unarmed.choices = [{ label: '返回大厅', target: 'fight' }]
    story.nodes.fight.choices = [{ label: '返回大厅', target: 'flee' }]
    delete story.nodes.fight.ending
    story.nodes.flee.choices = [{ label: '返回大厅', target: 'beg' }]
    delete story.nodes.flee.ending
    story.endings = { e_true: story.endings.e_true }

    const report = evaluateStory(story)
    expect(report.interaction.singleChoiceNodes).toBe(5)
    expect(report.interaction.longestSingleChoiceRun).toBeGreaterThanOrEqual(5)
    expect(report.interaction.repeatedLabels).toContainEqual({ label: '返回大厅', count: 3 })
    expect(report.findings.map((item) => item.code)).toContain('LONG_SINGLE_CHOICE_RUN')
    expect(report.findings.map((item) => item.code)).toContain('REPEATED_NAVIGATION_LABEL')
    expect(report).not.toHaveProperty('score')
  })

  it('只描述作品实际采用的机制，不因未采用谜题或关系而告警', () => {
    const report = evaluateStory(makeStory())
    expect(report.mechanics.puzzles).toMatchObject({ defined: 0, placed: 0 })
    expect(report.mechanics.relationships).toMatchObject({ characters: 0, effectfulChoices: 0 })
    expect(report.findings.map((item) => item.code)).not.toContain('NO_PUZZLES')
    expect(report.findings.map((item) => item.code)).not.toContain('NO_RELATIONSHIPS')
  })

  it('提示手动音效覆盖全部节点，避免把系统反馈当成逐节点装饰', () => {
    const story = makeStory()
    for (const node of Object.values(story.nodes)) node.sfx = 'click'
    const report = evaluateStory(story)
    expect(report.findings.map((item) => item.code)).toContain('SFX_EVERYWHERE')
  })

  it('把可重放条件软锁提升为明确候选问题', () => {
    const story = makeStory()
    story.nodes.start.choices.push({ label: '进入锁死房间', target: 'locked' })
    story.nodes.locked = {
      id: 'locked', text: '锁死。',
      choices: [{
        label: '被隐藏的出口', target: 'fight',
        when: { op: 'eq', var: 'never_set', value: true },
      }],
    }

    const report = evaluateStory(story)
    expect(report.findings).toContainEqual(expect.objectContaining({
      code: 'WALK_FAILURE_PATHS',
      evidence: ['soft_lock: locked'],
    }))
  })

  it('识别无状态自循环和同节点重复结果，但保留为可解释候选问题', () => {
    const story = makeStory()
    story.nodes.start.choices.push(
      { label: '原地等待', target: 'start' },
      { label: '换一种说法拿剑', target: 'armed', effects: { gain: ['剑'], set: { courage: 5 } } },
    )

    const report = evaluateStory(story)
    expect(report.interaction.selfLoopChoices).toBe(1)
    expect(report.interaction.duplicateOutcomeGroups).toBe(1)
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'NO_OP_SELF_LOOP' }))
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_CHOICE_OUTCOME' }))
  })

  it('报告没有影响条件、效果或推论的机制定义', () => {
    const story = makeStory()
    story.evidence = {
      e_used: { id: 'e_used', title: '有效证据', description: '用于推论。' },
      e_unused: { id: 'e_unused', title: '孤立证据', description: '没有后续引用。' },
    }
    story.deductions = {
      d_used: { id: 'd_used', statement: '有效推论', requires: { all: ['e_used'] } },
      d_unused: { id: 'd_unused', statement: '孤立推论', requires: { all: ['e_unused'] } },
    }
    story.puzzles = {
      p_unused: {
        id: 'p_unused', title: '孤立谜题', kind: 'code', prompt: '输入。', solution: '1',
      },
    }
    story.nodes.start.puzzles = ['p_unused']
    story.nodes.start.onEnter = { gainEvidence: ['e_used', 'e_unused'] }
    story.nodes.start.choices[0].when = { op: 'eq', var: '#deduction', value: 'd_used' }

    const report = evaluateStory(story)
    expect(report.mechanics.evidence.unrecovered).toEqual(['e_unused'])
    expect(report.mechanics.deductions.unrecovered).toEqual(['d_unused'])
    expect(report.mechanics.puzzles.unrecovered).toEqual(['p_unused'])
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'UNRECOVERED_EVIDENCE' }))
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'UNRECOVERED_DEDUCTION' }))
    expect(report.findings).toContainEqual(expect.objectContaining({ code: 'UNRECOVERED_PUZZLE' }))
  })

  it('提示连续氛围音、手动系统音效和长正文持续强动画', () => {
    const story = makeStory()
    story.nodes.start.sfx = 'drone'
    story.nodes.armed.sfx = 'drone'
    story.nodes.unarmed.sfx = 'click'
    story.nodes.armed.text = '很长的阅读正文。'.repeat(90)
    story.nodes.armed.fx = [{ name: 'flicker', intensity: 1.6, speed: 2 }]

    const report = evaluateStory(story)
    const codes = report.findings.map((item) => item.code)
    expect(codes).toContain('CONSECUTIVE_DRONE')
    expect(codes).toContain('REDUNDANT_SYSTEM_SFX')
    expect(codes).toContain('LONG_READING_STRONG_FX')
    expect(codes).toContain('HIGH_INTENSITY_FX')
  })
})
