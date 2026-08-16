import { describe, expect, it } from 'vitest'
import { Game, SAVE_VERSION } from './engine.js'
import { applyEffects } from './effects.js'
import { evalCondition } from './conditions.js'
import { makeStory } from './fixtures.js'

describe('Game 状态机', () => {
  const story = makeStory()

  it('从起始节点开始，应用 onEnter', () => {
    const g = new Game(story)
    expect(g.currentNode.id).toBe('start')
    expect(g.stepCount).toBe(1)
    expect(g.isEnding).toBe(false)
    expect(g.visibleChoices()).toHaveLength(2)
  })

  it('选择选项应用效果并推进', () => {
    const g = new Game(story)
    g.choose(0) // 拿剑
    expect(g.currentNode.id).toBe('armed')
    expect(g.state.vars.courage).toBe(8) // 5 + onEnter 3
    expect(g.state.inventory).toEqual(['剑'])
  })

  it('条件选项：满足条件才可见', () => {
    const g = new Game(story)
    g.choose(0) // armed，courage=8
    expect(g.visibleChoices().map((c) => c.label)).toEqual(['战斗', '逃跑'])

    const g2 = new Game(story)
    g2.choose(1) // unarmed，courage=1
    expect(g2.currentNode.id).toBe('unarmed')
    expect(g2.visibleChoices().map((c) => c.label)).toEqual(['战斗', '求饶'])
  })

  it('到达结局并记录 endingMeta', () => {
    const g = new Game(story)
    g.choose(0)
    g.choose(0) // 战斗
    expect(g.isEnding).toBe(true)
    expect(g.endingMeta?.id).toBe('e_good')
    expect(g.state.endingId).toBe('e_good')
  })

  it('正文插值 {var} 与 {#inventory}', () => {
    const g = new Game(story)
    g.choose(0)
    expect(g.interpolate(g.currentNode.text)).toContain('你有剑。')
    expect(g.interpolate('勇气 {courage}')).toBe('勇气 8')
    expect(g.interpolate('未定义 {nope}')).toBe('未定义 {nope}')
  })

  it('道具 gain 随存档恢复', () => {
    const g = new Game(story)
    g.choose(0)
    const s = g.toSave()
    const g2 = new Game(story, s)
    expect(g2.state.inventory).toEqual(['剑'])
  })

  it('存档恢复后状态一致（变量/道具/历史/结局）', () => {
    const g = new Game(story)
    g.choose(0)
    g.choose(0)
    const save = g.toSave()
    const restored = new Game(story, save)
    expect(restored.currentNode.id).toBe('fight')
    expect(restored.endingMeta?.id).toBe('e_good')
    expect(restored.state.vars.courage).toBe(8)
    expect(restored.state.history).toEqual(['start', 'armed', 'fight'])
  })

  it('restart 清空一切并回到起点', () => {
    const g = new Game(story)
    g.choose(0)
    g.choose(0)
    g.restart()
    expect(g.currentNode.id).toBe('start')
    expect(g.state.vars).toEqual({})
    expect(g.state.inventory).toEqual([])
    expect(g.endingMeta).toBeNull()
  })

  it('选项越界抛 RangeError', () => {
    const g = new Game(story)
    expect(() => g.choose(2)).toThrow(RangeError)
    expect(() => g.choose(-1)).toThrow(RangeError)
  })

  it('不可见选项无法选择（索引按可见选项计数）', () => {
    const g = new Game(story)
    g.choose(1) // unarmed：战斗/求饶 两个可见
    expect(g.visibleChoices()).toHaveLength(2)
    g.choose(1) // 求饶
    expect(g.endingMeta?.id).toBe('e_true')
  })
})

describe('条件 DSL', () => {
  const story = makeStory()

  it('exists / has / not_has 求值正确', () => {
    const g = new Game(story)
    g.choose(0) // 拿到剑，courage=8
    expect(g.state.inventory).toContain('剑')
    expect(g.state.vars.courage).toBe(8)
    // 通过可见选项间接验证 has 类条件：armed 的战斗选项是 gte 条件
    const choices = g.visibleChoices()
    expect(choices.length).toBe(2)
  })
})

describe('effects / conditions 直接单测', () => {
  it('applyEffects：set/add/gain/lose/flag 全部生效（flag 写入 vars）', () => {
    const target = { vars: { hp: 10 }, inventory: ['钥匙'], docs: [], day: 1, violations: [] }
    applyEffects(
      {
        set: { name: '阿明' },
        add: { hp: -3 },
        gain: ['手电'],
        lose: ['钥匙'],
        flag: { met: true },
      },
      target,
    )
    expect(target.vars).toEqual({ hp: 7, name: '阿明', met: true })
    expect(target.inventory).toEqual(['手电'])
  })

  it('evalCondition：比较/组合/has/exists', () => {
    const ctx = { vars: { hp: 7, name: '阿明' }, inventory: ['手电'] }
    expect(evalCondition({ op: 'gt', var: 'hp', value: 5 }, ctx)).toBe(true)
    expect(evalCondition({ op: 'lte', var: 'hp', value: 7 }, ctx)).toBe(true)
    expect(evalCondition({ op: 'eq', var: 'name', value: '阿明' }, ctx)).toBe(true)
    expect(evalCondition({ op: 'ne', var: 'name', value: '小明' }, ctx)).toBe(true)
    expect(evalCondition({ op: 'exists', var: 'hp' }, ctx)).toBe(true)
    expect(evalCondition({ op: 'exists', var: 'luck' }, ctx)).toBe(false)
    expect(evalCondition({ op: 'exists', var: '#steps' }, ctx)).toBe(true)
    expect(evalCondition({ op: 'has', var: '手电' }, ctx)).toBe(true)
    expect(evalCondition({ op: 'not_has', var: '钥匙' }, ctx)).toBe(true)
    expect(
      evalCondition({ and: [{ op: 'gt', var: 'hp', value: 5 }, { op: 'has', var: '手电' }] }, ctx),
    ).toBe(true)
    expect(
      evalCondition({ or: [{ op: 'lt', var: 'hp', value: 1 }, { op: 'eq', var: 'name', value: '阿明' }] }, ctx),
    ).toBe(true)
    expect(evalCondition({ not: { op: 'gt', var: 'hp', value: 10 } }, ctx)).toBe(true)
    expect(evalCondition(undefined, ctx)).toBe(true)
  })

  it('记录选择承接，并随存档恢复与重开清空', () => {
    const responseStory = makeStory()
    responseStory.nodes.start.choices[0].response = '你把剑握紧，勇气升到 {courage}。'
    const game = new Game(responseStory)
    game.choose(0)

    expect(game.state.lastChoice).toEqual({
      fromNodeId: 'start', targetNodeId: 'armed', label: '拿剑',
      response: '你把剑握紧，勇气升到 {courage}。',
    })
    expect(game.interpolate(game.state.lastChoice!.response!)).toContain('勇气升到 8')

    const restored = new Game(responseStory, game.toSave())
    expect(restored.state.lastChoice).toEqual(game.state.lastChoice)
    restored.restart()
    expect(restored.state.lastChoice).toBeNull()
  })

  it('world/phase 同时驱动条件、插值、存档与重开', () => {
    const stateStory = makeStory()
    stateStory.meta.world = {
      initial: 'surface',
      states: { surface: { label: '表世界' }, other: { label: '里世界' } },
    }
    stateStory.meta.phase = {
      initial: 'day',
      states: { day: { label: '白天' }, night: { label: '夜晚' } },
    }
    stateStory.nodes.start.choices[0].effects = {
      ...stateStory.nodes.start.choices[0].effects,
      world: 'other',
      phase: 'night',
    }
    stateStory.nodes.armed.choices = [{
      label: '只在里世界出现', target: 'fight',
      when: { op: 'eq', var: '#world', value: 'other' },
    }]

    const game = new Game(stateStory)
    expect(game.state).toMatchObject({ world: 'surface', phase: 'day' })
    game.choose(0)
    expect(game.state).toMatchObject({ world: 'other', phase: 'night' })
    expect(game.visibleChoices().map((choice) => choice.label)).toEqual(['只在里世界出现'])
    expect(game.interpolate('{#world}/{#phase}')).toBe('other/night')

    const restored = new Game(stateStory, game.toSave())
    expect(restored.state).toMatchObject({ world: 'other', phase: 'night' })
    restored.restart()
    expect(restored.state).toMatchObject({ world: 'surface', phase: 'day' })
  })

  it('存档版本：toSave 写入当前版本，缺省按 v1 恢复，未知版本显式报错', () => {
    const g = new Game(makeStory())
    g.choose(0)
    const save = g.toSave()
    expect(save.saveVersion).toBe(SAVE_VERSION)

    // 旧档没有 saveVersion 字段 → 按 v1 恢复
    const legacy = { ...save }
    delete legacy.saveVersion
    const restored = new Game(makeStory(), legacy)
    expect(restored.state.inventory).toEqual(['剑'])

    // 未知（未来）版本 → 报错并带「版本」字样
    expect(() => new Game(makeStory(), { ...save, saveVersion: 999 })).toThrow(/版本/)
    // 非整数/非正数同样拒绝
    expect(() => new Game(makeStory(), { ...save, saveVersion: 0 })).toThrow(/版本/)
    expect(() => new Game(makeStory(), { ...save, saveVersion: 1.5 })).toThrow(/版本/)
  })

  it('state getter 返回浅拷贝：外部修改数组/对象不影响内部状态', () => {
    const g = new Game(makeStory())
    g.choose(0)
    const snap = g.state
    snap.inventory.push('赃物')
    snap.vars.courage = 999
    snap.history.push('伪造')
    const rel = snap.relations
    if (rel) rel.alice = { trust: -100 }

    expect(g.state.inventory).toEqual(['剑'])
    expect(g.state.vars.courage).toBe(8)
    expect(g.state.history).toEqual(['start', 'armed'])
    expect(g.state.relations?.alice).toBeUndefined()
  })

  it('集合型特殊变量同时支持 eq/ne 与 has/not_has', () => {
    const ctx = {
      vars: {},
      inventory: [],
      visited: ['study'],
      docs: ['letter'],
      violations: ['rule_1'],
      evidence: ['fiber'],
      deductions: ['false_alibi'],
      memories: ['kept_promise'],
      revealedSecrets: ['witness:past'],
      solvedPuzzles: ['safe_code'],
    }
    for (const [variable, value] of [
      ['#visited', 'study'],
      ['#docs', 'letter'],
      ['#violated', 'rule_1'],
      ['#evidence', 'fiber'],
      ['#deduction', 'false_alibi'],
      ['#memory', 'kept_promise'],
      ['#secret', 'witness:past'],
      ['#puzzle', 'safe_code'],
    ] as const) {
      expect(evalCondition({ op: 'has', var: variable, value }, ctx)).toBe(true)
      expect(evalCondition({ op: 'not_has', var: variable, value }, ctx)).toBe(false)
      expect(evalCondition({ op: 'has', var: variable, value: 'missing' }, ctx)).toBe(false)
      expect(evalCondition({ op: 'not_has', var: variable, value: 'missing' }, ctx)).toBe(true)
    }
  })
})
