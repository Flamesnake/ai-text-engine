import { describe, expect, it } from 'vitest'
import { Game } from './engine.js'
import { validate } from './validate.js'
import { walkAllEndings } from './walk.js'
import type { Story } from './types.js'

function makeDeductionStory(): Story {
  return {
    meta: { title: '不在场证明' },
    start: 'start',
    evidence: {
      stopped_clock: {
        id: 'stopped_clock',
        title: '停住的厨房时钟',
        description: '时钟停在 22:10。',
        kind: 'observation',
      },
      maid_testimony: {
        id: 'maid_testimony',
        title: '女仆的证词',
        description: '管家在 22:20 才回到厨房。',
        kind: 'testimony',
      },
    },
    deductions: {
      false_alibi: {
        id: 'false_alibi',
        statement: '管家的不在场证明不成立',
        requires: { all: ['stopped_clock', 'maid_testimony'] },
      },
    },
    nodes: {
      start: {
        id: 'start',
        text: '调查开始。',
        onEnter: { gainEvidence: ['stopped_clock', 'maid_testimony'] },
        choices: [
          {
            label: '揭穿管家的谎言',
            target: 'truth',
            when: { op: 'eq', var: '#deduction', value: 'false_alibi' },
          },
          { label: '放弃调查', target: 'ordinary' },
        ],
      },
      truth: {
        id: 'truth', text: '谎言被揭穿。', choices: [],
        ending: { id: 'e_truth', title: '真相', kind: 'true' },
      },
      ordinary: {
        id: 'ordinary', text: '案件不了了之。', choices: [],
        ending: { id: 'e_ordinary', title: '未解', kind: 'bad' },
      },
    },
    endings: {
      e_truth: { id: 'e_truth', title: '真相', kind: 'true' },
      e_ordinary: { id: 'e_ordinary', title: '未解', kind: 'bad' },
    },
  }
}

describe('证据与推论', () => {
  it('玩家获得证据后可提交正确组合，形成推论并解锁选项', () => {
    const game = new Game(makeDeductionStory())

    expect(game.state.evidence).toEqual(['stopped_clock', 'maid_testimony'])
    expect(game.visibleChoices().map((choice) => choice.label)).toEqual(['放弃调查'])

    expect(game.confirmDeduction('false_alibi', ['stopped_clock', 'maid_testimony'])).toBe(true)
    expect(game.state.deductions).toEqual(['false_alibi'])
    expect(game.visibleChoices().map((choice) => choice.label)).toEqual([
      '揭穿管家的谎言',
      '放弃调查',
    ])
  })

  it('错误或未持有的证据组合不改变状态，推论效果只触发一次', () => {
    const story = makeDeductionStory()
    story.deductions!.false_alibi.onConfirmed = { add: { insight: 1 } }
    const game = new Game(story)

    expect(game.confirmDeduction('false_alibi', ['stopped_clock'])).toBe(false)
    expect(game.confirmDeduction('false_alibi', ['stopped_clock', 'unknown'])).toBe(false)
    expect(game.state.deductions).toEqual([])
    expect(game.state.vars.insight).toBeUndefined()

    expect(game.confirmDeduction('false_alibi', ['stopped_clock', 'maid_testimony'])).toBe(true)
    expect(game.confirmDeduction('false_alibi', ['stopped_clock', 'maid_testimony'])).toBe(true)
    expect(game.state.vars.insight).toBe(1)
  })

  it('多选无关证据不能通过：勾选必须恰好等于支持该推论的证据', () => {
    const story = makeDeductionStory()
    story.evidence!.decoy = {
      id: 'decoy',
      title: '无关的指纹',
      description: '一枚与案件无关的指纹。',
      kind: 'observation',
    }
    story.nodes.start.onEnter = { gainEvidence: ['stopped_clock', 'maid_testimony', 'decoy'] }
    const game = new Game(story)

    expect(game.confirmDeduction('false_alibi', ['stopped_clock', 'maid_testimony', 'decoy'])).toBe(false)
    expect(game.confirmDeduction('false_alibi', ['stopped_clock', 'maid_testimony'])).toBe(true)
  })

  it('校验无效证据引用与没有要求的推论', () => {
    const story = makeDeductionStory()
    story.nodes.start.onEnter = { gainEvidence: ['ghost'] }
    story.deductions!.false_alibi.requires = { all: ['stopped_clock', 'ghost'] }
    story.deductions!.empty = { id: 'empty', statement: '无依据结论', requires: {} }

    const problems = validate(story).join('\n')
    expect(problems).toContain('gainEvidence 引用了不存在的证据 "ghost"')
    expect(problems).toContain('推论 "false_alibi" 引用了不存在的证据 "ghost"')
    expect(problems).toContain('推论 "empty" 没有任何证据要求')
  })

  it('校验选项条件中不存在的证据和推论引用', () => {
    const story = makeDeductionStory()
    story.nodes.start.choices[0].when = {
      and: [
        { op: 'eq', var: '#evidence', value: 'ghost_evidence' },
        { op: 'eq', var: '#deduction', value: 'ghost_deduction' },
      ],
    }
    const problems = validate(story).join('\n')
    expect(problems).toContain('条件引用了不存在的证据 "ghost_evidence"')
    expect(problems).toContain('条件引用了不存在的推论 "ghost_deduction"')
  })

  it('路径探索会考虑玩家可在线索板确认推论，从而发现被推论解锁的结局', () => {
    const result = walkAllEndings(makeDeductionStory())
    expect(result.unreachableEndings).toEqual([])
    expect(result.endings.map((ending) => ending.endingId)).toEqual(['e_ordinary', 'e_truth'])
    const witness = result.reachability.witnesses.find((item) => item.endingId === 'e_truth')!
    expect(witness.actions).toContainEqual({
      type: 'deduction',
      nodeId: 'start',
      deductionId: 'false_alibi',
      evidence: ['stopped_clock', 'maid_testimony'],
    })
  })

  it('has 形式的推论条件在运行时和路径探索中都能解锁结局', () => {
    const story = makeDeductionStory()
    story.nodes.start.choices[0].when = { op: 'has', var: '#deduction', value: 'false_alibi' }
    const game = new Game(story)
    expect(game.confirmDeduction('false_alibi', ['stopped_clock', 'maid_testimony'])).toBe(true)
    expect(game.visibleChoices().map((choice) => choice.label)).toContain('揭穿管家的谎言')
    expect(walkAllEndings(story).unreachableEndings).toEqual([])
  })
})
