import { afterEach, describe, expect, it } from 'vitest'
import type { Story } from '../core/types.js'
import { walkAllEndings } from '../core/walk.js'
import { DomWitnessReplayError, replayFailureWitnessInDom, replayWitnessInDom } from './witness-replay.js'

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
})

describe('replayWitnessInDom', () => {
  it('通过真实推理板、谜题输入和场景选项重放结局见证', () => {
    const story = makeInteractiveStory()
    const witness = walkAllEndings(story).reachability.witnesses[0]
    const root = document.createElement('div')
    document.body.append(root)

    const report = replayWitnessInDom(root, story, witness, {
      saveKey: 'test:witness:success',
      storage: localStorage,
    })

    expect(report).toEqual({
      endingId: 'e_true',
      actions: witness.actions.length,
      choices: 1,
      deductions: 1,
      puzzles: 1,
    })
    expect(root.querySelector('.ending-title')?.textContent).toBe('真相')
  })

  it('失败时报告动作序号、当前节点与可见选项，不输出剧情正文', () => {
    const story = makeInteractiveStory()
    const witness = walkAllEndings(story).reachability.witnesses[0]
    const broken = {
      ...witness,
      actions: witness.actions.map((action) =>
        action.type === 'choice' ? { ...action, target: 'missing' } : action),
    }
    const root = document.createElement('div')
    document.body.append(root)

    let thrown: unknown
    try {
      replayWitnessInDom(root, story, broken, {
        saveKey: 'test:witness:failure',
        storage: localStorage,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(DomWitnessReplayError)
    expect(thrown).toMatchObject({
      endingId: 'e_true',
      actionIndex: 2,
      nodeId: 'start',
      visibleChoices: ['进入终点'],
    })
    expect((thrown as Error).message).not.toContain(story.nodes.start.text)
  })

  it('在真实 DOM 中重放并确认条件软锁', () => {
    const story = makeInteractiveStory()
    story.nodes.start.choices.unshift({ label: '进入锁死房间', target: 'locked' })
    story.deductions!.d_missing = {
      id: 'd_missing', statement: '缺少证据的推论', requires: { all: ['never_owned'] },
    }
    story.nodes.locked = {
      id: 'locked', text: '不应进入摘要的锁死正文。',
      choices: [{
        label: '被锁住的出口', target: 'end',
        when: { op: 'eq', var: 'missing_flag', value: true },
      }],
    }
    const failure = walkAllEndings(story).failures.witnesses.find((item) => item.nodeId === 'locked')!
    const root = document.createElement('div')
    document.body.append(root)

    const report = replayFailureWitnessInDom(root, story, failure, {
      saveKey: 'test:witness:soft-lock', storage: localStorage,
    })

    expect(report).toMatchObject({ kind: 'soft_lock', nodeId: 'locked', choices: 1 })
    expect(root.querySelectorAll('.choice-btn')).toHaveLength(0)
    expect(root.querySelector('[data-ending-id]')).toBeNull()
    expect(root.querySelector('[data-deduction-choice]')).not.toBeNull()
  })
})

function makeInteractiveStory(): Story {
  return {
    meta: { title: 'DOM 见证测试' },
    start: 'start',
    endings: { e_true: { id: 'e_true', title: '真相', kind: 'true' } },
    evidence: {
      e_clock: { id: 'e_clock', title: '停表', description: '指针停在午夜。' },
    },
    deductions: {
      d_time: {
        id: 'd_time', statement: '时间成立', hint: '检查停表。',
        requires: { all: ['e_clock'] },
      },
    },
    puzzles: {
      p_safe: {
        id: 'p_safe', title: '保险箱', kind: 'code', prompt: '输入日期。', solution: '0707',
        actionLabel: '打开保险箱',
      },
    },
    nodes: {
      start: {
        id: 'start', text: '这是不会出现在错误摘要里的正文。',
        onEnter: { gainEvidence: ['e_clock'] },
        puzzles: ['p_safe'],
        choices: [{
          label: '进入终点', target: 'end',
          when: {
            and: [
              { op: 'eq', var: '#deduction', value: 'd_time' },
              { op: 'eq', var: '#puzzle', value: 'p_safe' },
            ],
          },
        }],
      },
      end: {
        id: 'end', text: '终。', choices: [],
        ending: { id: 'e_true', title: '真相', kind: 'true' },
      },
    },
  }
}
