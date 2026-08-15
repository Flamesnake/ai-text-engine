import { describe, expect, it } from 'vitest'
import type { Story } from './types.js'
import { validate, validateExperience } from './validate.js'
import { Game } from './engine.js'
import { walkAllEndings, type EndingWitness } from './walk.js'
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

  it('校验舞台角色引用、焦点与站位冲突', () => {
    const story = makeStory()
    story.characters = {
      alice: { id: 'alice', name: '爱丽丝', description: '测试角色。' },
    }
    story.nodes.start.stage = {
      backdrop: 'interior',
      actors: [
        { characterId: 'alice', position: 'left', focus: true },
        { characterId: 'missing', position: 'left', focus: true },
      ],
    }

    const all = validate(story).join('\n')
    expect(all).toContain('不存在的角色 "missing"')
    expect(all).toContain('同时聚焦了多个角色')
    expect(all).toContain('位置 "left" 被多个角色占用')
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

  it('校验 world/phase 的初始状态、切换目标与条件引用', () => {
    const story = makeStory()
    story.meta.world = { initial: 'missing', states: { surface: {} } }
    story.meta.phase = { initial: 'day', states: { day: {}, night: {} } }
    story.nodes.start.choices[0].effects = {
      ...story.nodes.start.choices[0].effects,
      world: 'other',
    }
    story.nodes.start.choices[1].when = { op: 'eq', var: '#phase', value: 'dawn' }

    const all = validate(story).join('\n')
    expect(all).toContain('world 初始状态 "missing"')
    expect(all).toContain('未定义的 world 状态 "other"')
    expect(all).toContain('未定义的 phase 状态 "dawn"')
  })

  it('walk 能穿过状态切换与状态门控证明结局可达', () => {
    const story = makeStory()
    story.meta.world = { initial: 'surface', states: { surface: {}, other: {} } }
    story.nodes.start.choices = [{ label: '坠入里世界', target: 'armed', effects: { world: 'other' } }]
    story.nodes.armed.choices = [{
      label: '看见出口', target: 'fight',
      when: { op: 'eq', var: '#world', value: 'other' },
    }]
    story.nodes.unarmed.choices = []
    delete story.nodes.unarmed
    story.nodes.flee.choices = []
    delete story.nodes.flee
    story.nodes.beg.choices = []
    delete story.nodes.beg
    story.endings = { e_good: story.endings.e_good }

    const walk = walkAllEndings(story)
    expect(walk.unreachableEndings).toEqual([])
    expect(walk.truncated).toBe(false)
  })

  it('提示 anyOf 单元素组误用与真结局绕过核心调查系统', () => {
    const story: Story = {
      meta: { title: '推理体验检查' },
      start: 'start',
      endings: { e_true: { id: 'e_true', title: '真相', kind: 'true' } },
      evidence: {
        footprint: { id: 'footprint', title: '脚印', description: '门口有脚印' },
        testimony: { id: 'testimony', title: '证词', description: '邻居听见争吵' },
        receipt: { id: 'receipt', title: '收据', description: '柜中藏着收据' },
      },
      deductions: {
        rescued: {
          id: 'rescued',
          statement: '有人把失踪者带走了',
          hint: '继续检查门口和访问邻居',
          requires: { anyOf: [['footprint'], ['testimony']] },
        },
        theft: {
          id: 'theft',
          statement: '管理员实施了盗窃',
          hint: '检查管理员的储物柜',
          requires: { all: ['receipt'] },
        },
      },
      characters: {
        neighbour: {
          id: 'neighbour', name: '邻居', description: '关键证人',
          relations: { trust: { label: '信任', initial: 0 } },
        },
      },
      puzzles: {
        cabinet: {
          id: 'cabinet', title: '工具柜', prompt: '输入密码', kind: 'code', solution: '0824',
          onSolved: { gainEvidence: ['receipt'] },
        },
      },
      nodes: {
        start: {
          id: 'start', text: '调查开始。', puzzles: ['cabinet'],
          choices: [
            {
              label: '安抚邻居', target: 'conclusion',
              effects: {
                adjustRelation: [{ characterId: 'neighbour', stat: 'trust', add: 10 }],
                remember: ['安抚过邻居'],
              },
            },
          ],
        },
        conclusion: {
          id: 'conclusion', text: '作出判断。',
          choices: [{
            label: '公布全部真相', target: 'truth',
            when: { var: '#deduction', op: 'eq', value: 'rescued' },
          }],
        },
        truth: {
          id: 'truth', text: '真相揭晓。', choices: [],
          ending: { id: 'e_true', title: '真相', kind: 'true' },
        },
      },
    }

    const warnings = validateExperience(story).join('\n')
    expect(warnings).toContain('推论 "rescued" 的 anyOf 全是单元素组')
    expect(warnings).toContain('真结局入口仅要求 1 条推论')
    expect(warnings).toContain('所有真结局入口都可绕过 1 个谜题')
    expect(warnings).toContain('所有真结局入口都可绕过人物关系/秘密/记忆系统')
    expect(validate(story)).toEqual([])
  })

  it('真结局整合多条推论、谜题证据和人物关系时不误报', () => {
    const story: Story = {
      meta: { title: '完整推理链' },
      start: 'start',
      endings: { e_true: { id: 'e_true', title: '真相', kind: 'true' } },
      evidence: {
        clue: { id: 'clue', title: '现场', description: '现场证据' },
        receipt: { id: 'receipt', title: '收据', description: '柜中收据' },
      },
      deductions: {
        means: { id: 'means', statement: '作案手段成立', hint: '查现场', requires: { all: ['clue'] } },
        motive: { id: 'motive', statement: '动机成立', hint: '开柜子', requires: { all: ['receipt'] } },
      },
      characters: {
        witness: {
          id: 'witness', name: '证人', description: '知情者',
          relations: { trust: { label: '信任', initial: 0 } },
        },
      },
      puzzles: {
        safe: {
          id: 'safe', title: '保险柜', prompt: '输入密码', kind: 'code', solution: '1234',
          onSolved: { gainEvidence: ['receipt'] },
        },
      },
      nodes: {
        start: {
          id: 'start', text: '调查。', puzzles: ['safe'],
          onEnter: { gainEvidence: ['clue'] },
          choices: [{
            label: '取得证人信任', target: 'conclusion',
            effects: { adjustRelation: [{ characterId: 'witness', stat: 'trust', add: 60 }] },
          }],
        },
        conclusion: {
          id: 'conclusion', text: '结案。',
          choices: [{
            label: '公布真相', target: 'truth',
            when: { and: [
              { var: '#deduction', op: 'eq', value: 'means' },
              { var: '#deduction', op: 'eq', value: 'motive' },
              { var: '#relation:witness:trust', op: 'gte', value: 50 },
            ] },
          }],
        },
        truth: {
          id: 'truth', text: '真相。', choices: [],
          ending: { id: 'e_true', title: '真相', kind: 'true' },
        },
      },
    }

    const warnings = validateExperience(story).join('\n')
    expect(warnings).not.toContain('真结局入口仅要求')
    expect(warnings).not.toContain('绕过 1 个谜题')
    expect(warnings).not.toContain('绕过人物关系/秘密/记忆系统')
    expect(validate(story)).toEqual([])
  })

  it('提示多个节点重复同一视觉覆盖，应提升到全局以减少冗余', () => {
    const story = makeStory()
    story.nodes.start.presentation = { typography: 'mono', choiceStyle: 'commands' }
    story.nodes.armed.presentation = { typography: 'mono', choiceStyle: 'commands' }
    story.nodes.unarmed.presentation = { typography: 'mono', choiceStyle: 'commands' }

    expect(validateExperience(story).join('\n')).toContain(
      '3 个节点重复相同 presentation',
    )
  })

  it('校验富文本条件揭示引用，并检查片段正文插值', () => {
    const story = makeStory()
    story.nodes.start.blocks = [{
      type: 'para',
      text: '纯文本回退：{missing_var}',
      segments: [{
        text: '凌晨三点',
        style: 'redacted',
        revealWhen: { op: 'eq', var: '#evidence', value: 'missing_evidence' },
      }],
    }]

    const problems = validate(story).join('\n')
    expect(problems).toContain('missing_evidence')
    expect(problems).toContain('{missing_var}')
  })
})

describe('walkAllEndings 全路径模拟', () => {
  it('统计 3 个结局全部可达及最短步数', () => {
    const result = walkAllEndings(makeStory())
    expect(result.truncated).toBe(false)
    expect(result.unreachableEndings).toEqual([])
    expect(result.warnings).toEqual([])
    const ids = result.endings.map((e) => e.endingId).sort()
    expect(ids).toEqual(['e_bad', 'e_good', 'e_true'])
    const good = result.endings.find((e) => e.endingId === 'e_good')!
    // 好结局：start→armed→fight = 3 步；start→unarmed→fight = 3 步
    expect(good.minSteps).toBe(3)
    expect(good.paths).toBeGreaterThanOrEqual(2)
    expect(result.coverage).toEqual({ complete: true, reasons: [] })
    expect(result.reachability.allEndingsProven).toBe(true)
    expect(result.reachability.witnesses).toHaveLength(3)
    for (const witness of result.reachability.witnesses) {
      replayWitness(makeStory(), witness)
    }
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
    expect(result.coverage.complete).toBe(true)
    expect(result.reachability.allEndingsProven).toBe(false)
    expect(result.reachability.unprovenEndings).toContain('e_fake')
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

  it('为条件全部锁死的状态生成最短软锁见证，但不把可推理解锁误报为软锁', () => {
    const story = makeStory()
    story.nodes.start.choices.push({ label: '进入锁死房间', target: 'locked' })
    story.nodes.locked = {
      id: 'locked', text: '门在身后关上。',
      choices: [{
        label: '不存在的出口', target: 'fight',
        when: { op: 'eq', var: 'never_set', value: true },
      }],
    }

    const result = walkAllEndings(story)
    expect(result.failures.complete).toBe(true)
    expect(result.failures.witnesses).toContainEqual(expect.objectContaining({
      kind: 'soft_lock',
      nodeId: 'locked',
      blockedChoices: ['不存在的出口'],
      actions: [expect.objectContaining({ type: 'choice', target: 'locked' })],
    }))

    const interactive = walkAllEndings(makeDeductionUnlockStory())
    expect(interactive.failures.witnesses).toEqual([])
  })

  it('为没有 ending 的静态终点生成失败见证', () => {
    const story = makeStory()
    story.nodes.start.choices.push({ label: '走入断头路', target: 'void' })
    story.nodes.void = { id: 'void', text: '没有后续。', choices: [] }

    const result = walkAllEndings(story)
    expect(result.failures.witnesses).toContainEqual(expect.objectContaining({
      kind: 'invalid_terminal',
      nodeId: 'void',
      blockedChoices: [],
    }))
  })

  it('达到全局状态预算时立即截断并明确标记结果不完整', () => {
    const result = walkAllEndings(makeStory(), { maxStates: 1 })
    expect(result.truncated).toBe(true)
    expect(result.nodesVisited).toBe(1)
    expect(result.warnings.join('\n')).toContain('全局状态预算 1')
    expect(result.coverage).toEqual({ complete: false, reasons: ['state_budget'] })
    expect(result.reachability.allEndingsProven).toBe(true)
    expect(result.reachability.unprovenEndings).toEqual([])
    expect(result.reachability.witnessSearch.used).toBeGreaterThan(0)
    expect(result.reachability.witnesses.some((item) => item.source === 'targeted')).toBe(true)
    for (const witness of result.reachability.witnesses) replayWitness(makeStory(), witness)
  })

  it('报告状态预算利用率与热点节点，接近上限时主动警告', () => {
    const baseline = walkAllEndings(makeStory())
    const maxStates = baseline.nodesVisited + 1
    const result = walkAllEndings(makeStory(), {
      maxStates,
      diagnostics: true,
      topNodes: 2,
    })

    expect(result.truncated).toBe(false)
    expect(result.budget).toEqual({
      used: result.nodesVisited,
      limit: maxStates,
      utilization: expect.any(Number),
    })
    expect(result.budget.utilization).toBeGreaterThanOrEqual(0.8)
    expect(result.hotNodes).toHaveLength(2)
    expect(result.hotNodes![0].visits).toBeGreaterThanOrEqual(result.hotNodes![1].visits)
    expect(result.warnings.join('\n')).toContain('状态预算已使用')
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

  it('未被条件引用的 visited 历史不应制造调查顺序的子集状态', () => {
    const story: Story = {
      meta: { title: '自由调查' },
      start: 'hub',
      endings: { e_end: { id: 'e_end', title: '终', kind: 'good' } },
      nodes: {
        hub: {
          id: 'hub', text: '大厅',
          choices: [
            ...Array.from({ length: 6 }, (_, index) => ({
              label: `调查${index}`, target: `room${index}`,
            })),
            { label: '结案', target: 'end' },
          ],
        },
        ...Object.fromEntries(Array.from({ length: 6 }, (_, index) => [
          `room${index}`,
          { id: `room${index}`, text: '无状态房间', choices: [{ label: '返回', target: 'hub' }] },
        ])),
        end: {
          id: 'end', text: '终', choices: [],
          ending: { id: 'e_end', title: '终', kind: 'good' },
        },
      },
    }

    const result = walkAllEndings(story)
    expect(result.unreachableEndings).toEqual([])
    expect(result.nodesVisited).toBeLessThan(25)
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

function replayWitness(story: Story, witness: EndingWitness): void {
  const game = new Game(story)
  for (const action of witness.actions) {
    expect(game.currentNode.id).toBe(action.nodeId)
    if (action.type === 'deduction') {
      expect(game.confirmDeduction(action.deductionId, action.evidence)).toBe(true)
      continue
    }
    if (action.type === 'puzzle') {
      const solution = story.puzzles?.[action.puzzleId]?.solution
      expect(solution).toBeDefined()
      expect(game.attemptPuzzle(action.puzzleId, solution!).solved).toBe(true)
      continue
    }
    const index = game.visibleChoices().findIndex(
      (choice) => choice.label === action.label && choice.target === action.target,
    )
    expect(index).toBeGreaterThanOrEqual(0)
    game.choose(index)
  }
  expect(game.endingMeta?.id).toBe(witness.endingId)
}

function makeDeductionUnlockStory(): Story {
  return {
    meta: { title: '推理解锁不应误报' },
    start: 'start',
    endings: { e_end: { id: 'e_end', title: '终', kind: 'good' } },
    evidence: { e_key: { id: 'e_key', title: '钥匙证据', description: '能打开出口。' } },
    deductions: {
      d_key: { id: 'd_key', statement: '出口可开', requires: { all: ['e_key'] } },
    },
    nodes: {
      start: {
        id: 'start', text: '先推理。', onEnter: { gainEvidence: ['e_key'] },
        choices: [{
          label: '离开', target: 'end',
          when: { op: 'eq', var: '#deduction', value: 'd_key' },
        }],
      },
      end: {
        id: 'end', text: '终。', choices: [],
        ending: { id: 'e_end', title: '终', kind: 'good' },
      },
    },
  }
}
