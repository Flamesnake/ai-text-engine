import { describe, expect, it } from 'vitest'
import { Game } from './engine.js'
import { validate } from './validate.js'
import { walkAllEndings } from './walk.js'
import type { Story } from './types.js'

function makePuzzleStory(): Story {
  return {
    meta: { title: '书房保险箱' },
    start: 'study',
    puzzles: {
      safe_code: {
        id: 'safe_code',
        title: '书房保险箱',
        prompt: '输入四位密码。',
        kind: 'code',
        solution: '2210',
        hints: ['观察停住的时钟。', '按小时和分钟组合四位数。'],
        onSolved: { gainEvidence: ['ledger'] },
      },
    },
    evidence: {
      ledger: { id: 'ledger', title: '秘密账本', description: '记录了管家的秘密交易。', kind: 'document' },
    },
    nodes: {
      study: {
        id: 'study', text: '墙上嵌着一只保险箱。',
        puzzles: ['safe_code'],
        choices: [
          {
            label: '取出秘密账本', target: 'truth',
            when: { op: 'eq', var: '#puzzle', value: 'safe_code' },
          },
          { label: '放弃', target: 'leave' },
        ],
      },
      truth: {
        id: 'truth', text: '账本证明了一切。', choices: [],
        ending: { id: 'e_truth', title: '账本', kind: 'true' },
      },
      leave: {
        id: 'leave', text: '你空手离开。', choices: [],
        ending: { id: 'e_leave', title: '空手而归', kind: 'bad' },
      },
    },
    endings: {
      e_truth: { id: 'e_truth', title: '账本', kind: 'true' },
      e_leave: { id: 'e_leave', title: '空手而归', kind: 'bad' },
    },
  }
}

describe('密码谜题', () => {
  it('错误答案不解锁，正确答案解锁内容且成功效果只执行一次', () => {
    const game = new Game(makePuzzleStory())
    expect(game.visibleChoices().map((choice) => choice.label)).toEqual(['放弃'])

    expect(game.attemptPuzzle('safe_code', '1234')).toEqual({ solved: false, attempts: 1 })
    expect(game.state.solvedPuzzles).toEqual([])
    expect(game.state.evidence).toEqual([])

    expect(game.attemptPuzzle('safe_code', ' 2210 ')).toEqual({ solved: true, attempts: 1 })
    expect(game.state.solvedPuzzles).toEqual(['safe_code'])
    expect(game.state.evidence).toEqual(['ledger'])
    expect(game.visibleChoices().map((choice) => choice.label)).toEqual(['取出秘密账本', '放弃'])

    expect(game.attemptPuzzle('safe_code', '2210')).toEqual({ solved: true, attempts: 1 })
    expect(game.state.evidence).toEqual(['ledger'])
  })

  it('显式绑定的谜题只能在对应场景中尝试', () => {
    const story = makePuzzleStory()
    story.nodes.study.choices[1] = { label: '去门厅', target: 'leave' }
    story.nodes.leave.choices = [{ label: '返回书房', target: 'study' }]
    delete story.nodes.leave.ending
    const game = new Game(story)

    expect(game.availablePuzzles().map((puzzle) => puzzle.id)).toEqual(['safe_code'])
    game.choose(0)
    expect(game.availablePuzzles()).toEqual([])
    expect(game.attemptPuzzle('safe_code', '2210')).toEqual({ solved: false, attempts: 0 })
  })

  it('提示按顺序逐条揭示并随存档恢复，不会越过提示末尾', () => {
    const story = makePuzzleStory()
    const game = new Game(story)

    expect(game.revealPuzzleHint('safe_code')).toEqual({ hint: '观察停住的时钟。', revealed: 1, total: 2 })
    expect(game.revealPuzzleHint('safe_code')).toEqual({ hint: '按小时和分钟组合四位数。', revealed: 2, total: 2 })
    expect(game.revealPuzzleHint('safe_code')).toEqual({ hint: null, revealed: 2, total: 2 })

    const restored = new Game(story, game.toSave())
    expect(restored.state.puzzleHints.safe_code).toBe(2)
    expect(restored.revealPuzzleHint('ghost')).toEqual({ hint: null, revealed: 0, total: 0 })
  })

  it('校验空答案和条件中不存在的谜题引用', () => {
    const story = makePuzzleStory()
    story.puzzles!.safe_code.solution = '  '
    story.nodes.study.choices[0].when = { op: 'eq', var: '#puzzle', value: 'ghost' }
    const problems = validate(story).join('\n')
    expect(problems).toContain('谜题 "safe_code" 的 solution 不能为空')
    expect(problems).toContain('谜题条件引用了不存在的谜题 "ghost"')
  })

  it('校验场景中不存在的谜题引用', () => {
    const story = makePuzzleStory()
    story.nodes.study.puzzles = ['ghost']
    expect(validate(story).join('\n')).toContain('节点 "study" 引用了不存在的谜题 "ghost"')
  })

  it('校验谜题成功效果引用的不存在证据', () => {
    const story = makePuzzleStory()
    story.puzzles!.safe_code.onSolved = { gainEvidence: ['ghost_evidence'] }
    expect(validate(story).join('\n')).toContain('gainEvidence 引用了不存在的证据 "ghost_evidence"')
  })

  it('路径探索会考虑玩家可解开的谜题，发现谜题解锁的结局', () => {
    const result = walkAllEndings(makePuzzleStory())
    expect(result.unreachableEndings).toEqual([])
    expect(result.endings.map((ending) => ending.endingId)).toEqual(['e_leave', 'e_truth'])
    const witness = result.reachability.witnesses.find((item) => item.endingId === 'e_truth')!
    expect(witness.actions).toContainEqual({ type: 'puzzle', nodeId: 'study', puzzleId: 'safe_code' })
  })

  it('has 形式的谜题条件在运行时和路径探索中都能解锁结局', () => {
    const story = makePuzzleStory()
    story.nodes.study.choices[0].when = { op: 'has', var: '#puzzle', value: 'safe_code' }
    const game = new Game(story)
    expect(game.attemptPuzzle('safe_code', '2210').solved).toBe(true)
    expect(game.visibleChoices().map((choice) => choice.label)).toContain('取出秘密账本')
    expect(walkAllEndings(story).unreachableEndings).toEqual([])
  })
})
