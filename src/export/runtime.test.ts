import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountTextAdventure } from './runtime.js'
import { makeStory } from '../core/fixtures.js'

/** 内存版 Storage（用于注入，避免污染真实 localStorage） */
function memoryStorage(): { storage: Storage; map: Map<string, string> } {
  const map = new Map<string, string>()
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size
    },
  } as Storage
  return { storage, map }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('mountTextAdventure 运行时集成', () => {
  it('宿主可显式销毁实例并清空持续运行资源', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const { storage } = memoryStorage()
    const mounted = mountTextAdventure(root, makeStory(), { saveKey: 'test:destroy', storage })
    expect(root.childElementCount).toBeGreaterThan(0)

    await mounted.destroy()
    expect(root.childElementCount).toBe(0)
  })

  it('应用全局视觉外壳与设计令牌，并允许节点只覆盖差异项', () => {
    const story = makeStory()
    story.meta.presentation = {
      shell: 'dossier',
      typography: 'mono',
      density: 'compact',
      shape: 'sharp',
      choiceStyle: 'commands',
    }
    story.nodes.armed.presentation = { shell: 'cinematic', density: 'spacious' }
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage } = memoryStorage()

    mountTextAdventure(root, story, { saveKey: 'test:presentation', storage })
    const titleClasses = root.querySelector('.title-screen')!.classList
    for (const cls of ['shell-dossier', 'type-mono', 'density-compact', 'shape-sharp', 'choice-commands']) {
      expect(titleClasses.contains(cls)).toBe(true)
    }

    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
    expect(root.querySelector('.game-screen')!.classList.contains('shell-dossier')).toBe(true)
    expect(root.querySelector('.game-screen')!.classList.contains('choice-commands')).toBe(true)
    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[0]).click()
    const nodeClasses = root.querySelector('.game-screen')!.classList
    for (const cls of ['shell-cinematic', 'type-mono', 'density-spacious', 'shape-sharp', 'choice-commands']) {
      expect(nodeClasses.contains(cls)).toBe(true)
    }
  })

  it.each(['novel', 'dossier', 'chat', 'cinematic'] as const)(
    '支持 %s 界面外壳',
    (shell) => {
      const story = makeStory()
      story.meta.presentation = { shell }
      const root = document.createElement('div')
      document.body.appendChild(root)
      const { storage } = memoryStorage()
      mountTextAdventure(root, story, { saveKey: `test:shell:${shell}`, storage })
      ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
      expect(root.querySelector('.game-screen')!.classList.contains(`shell-${shell}`)).toBe(true)
    },
  )

  it('完整游玩流程：标题屏 → 开始 → 拿剑 → 战斗 → 好结局，且存档写入', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage, map } = memoryStorage()

    mountTextAdventure(root, makeStory(), { saveKey: 'test:1', storage })

    // 标题屏
    expect(root.querySelector<HTMLButtonElement>('[data-action="start"]')).not.toBeNull()
    expect(root.querySelector('.title-main')?.textContent).toBe('测试剧情')

    // 开始游戏
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
    expect(root.querySelector('.card-text')?.textContent).toContain('开局')

    // 选项渲染（含条件过滤前的完整选项）
    let btns = [...root.querySelectorAll<HTMLButtonElement>('[data-choice]')]
    expect(btns.map((b) => b.textContent)).toEqual(['拿剑', '空手'])

    // 拿剑 → armed：onEnter courage+3=8，道具栏显示
    btns[0].click()
    expect(root.querySelector('.card-text')?.textContent).toContain('你有剑')
    expect(root.querySelectorAll('.inv-chip').length).toBe(1)

    // 条件选项：courage=8 满足战斗条件
    btns = [...root.querySelectorAll<HTMLButtonElement>('[data-choice]')]
    expect(btns.map((b) => b.textContent)).toEqual(['战斗', '逃跑'])

    // 战斗 → 好结局
    btns[0].click()
    expect(root.querySelector('.ending-title')?.textContent).toBe('好结局')
    expect(root.querySelector('.ending-good .ending-badge')?.textContent).toContain('生还')

    // 存档已写入
    expect(map.get('test:1')).toBeTruthy()
  })

  it('空手路线：条件选项被过滤（无剑时无战斗强化），走求饶到真相结局', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage } = memoryStorage()

    mountTextAdventure(root, makeStory(), { saveKey: 'test:2', storage })
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[1]).click() // 空手
    expect(root.querySelector('.card-text')?.textContent).toContain('手无寸铁')

    let btns = [...root.querySelectorAll<HTMLButtonElement>('[data-choice]')]
    expect(btns.map((b) => b.textContent)).toEqual(['战斗', '求饶'])
    btns[1].click() // 求饶

    expect(root.querySelector('.ending-title')?.textContent).toBe('真相')
    expect(root.querySelector('.ending-true')).not.toBeNull()
  })

  it('存档恢复：刷新后「继续上次」回到上次节点', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage } = memoryStorage()

    // 第一次会话：走到 armed
    mountTextAdventure(root, makeStory(), { saveKey: 'test:3', storage })
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[0]).click()
    expect(root.querySelector('.card-text')?.textContent).toContain('你有剑')

    // 第二次会话（模拟刷新）：标题屏出现「继续上次」
    root.innerHTML = ''
    mountTextAdventure(root, makeStory(), { saveKey: 'test:3', storage })
    expect(root.querySelector<HTMLButtonElement>('[data-action="continue"]')).not.toBeNull()
    ;(root.querySelector('[data-action="continue"]') as HTMLButtonElement).click()
    expect(root.querySelector('.card-text')?.textContent).toContain('你有剑')
    expect(root.querySelectorAll('.inv-chip').length).toBe(1)
  })

  it('结局后「再来一次」回到起点，「返回标题」回标题屏', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage } = memoryStorage()

    mountTextAdventure(root, makeStory(), { saveKey: 'test:4', storage })
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[0]).click() // 拿剑
    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[0]).click() // 战斗
    expect(root.querySelector('.ending-title')?.textContent).toBe('好结局')

    ;(root.querySelector('[data-action="replay"]') as HTMLButtonElement).click()
    expect(root.querySelector('.card-text')?.textContent).toContain('开局')

    ;(root.querySelector('[data-action="clear"]') as HTMLButtonElement)?.click() // 无存档时无此按钮
    // 走到结局再返回标题
    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[1]).click() // 空手
    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[1]).click() // 求饶
    ;(root.querySelector('[data-action="title"]') as HTMLButtonElement).click()
    expect(root.querySelector('.title-main')?.textContent).toBe('测试剧情')
  })

  it('meta.hud 配置后显示统计条，数值随变量变化', () => {    const story = makeStory()
    story.meta.hud = [{ var: 'courage', label: '勇气', max: 10 }]
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage } = memoryStorage()

    mountTextAdventure(root, story, { saveKey: 'test:hud', storage })
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
    // 开局未设 courage → 显示 0 / 10
    expect(root.querySelector('.hud-label')?.textContent).toBe('勇气')
    expect(root.querySelector('.hud-value')?.textContent).toBe('0 / 10')

    // 空手：courage=1
    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[1]).click()
    expect(root.querySelector('.hud-value')?.textContent).toBe('1 / 10')
    expect(root.querySelector<HTMLElement>('.hud-fill')?.style.width).toBe('10%')

    // 无 hud 配置时不渲染 hud
    const plain = document.createElement('div')
    document.body.appendChild(plain)
    mountTextAdventure(plain, makeStory(), { saveKey: 'test:hud2', storage })
    ;(plain.querySelector('[data-action="start"]') as HTMLButtonElement).click()
    expect(plain.querySelector('.hud')).toBeNull()
  })

  it('有成就定义时标题屏出现成就入口，解锁后弹 toast，列表画面正确显示', () => {
    const story = makeStory()
    story.achievements = [
      {
        id: 'sword',
        title: '持剑者',
        description: '获得剑',
        icon: '⚔️',
        when: { op: 'has', var: '剑' },
      },
      {
        id: 'hidden_one',
        title: '隐藏成就',
        description: '秘密',
        hidden: true,
        when: { op: 'eq', var: '#visited', value: 'unarmed' },
      },
    ]
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage, map } = memoryStorage()

    mountTextAdventure(root, story, { saveKey: 'test:ach', storage })
    // 标题屏有成就按钮
    const achBtn = root.querySelector<HTMLButtonElement>('[data-action="achievements"]')
    expect(achBtn).not.toBeNull()

    // 进入成就列表：全部锁定；隐藏成就显示 ???，普通成就显示标题
    achBtn!.click()
    expect(root.querySelectorAll('.ach-item').length).toBe(2)
    const lockedTitles = [...root.querySelectorAll('.ach-locked .ach-title')].map(
      (el) => el.textContent,
    )
    expect(lockedTitles).toContain('？？？') // hidden 成就锁定
    expect(lockedTitles).toContain('持剑者') // 非隐藏成就显示标题
    ;(root.querySelector('[data-action="back"]') as HTMLButtonElement).click()
    expect(root.querySelector('.title-main')).not.toBeNull()

    // 开始游戏拿剑 → 解锁 toast 出现
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[0]).click() // 拿剑
    expect(root.querySelector('.achievement-toast')?.textContent).toContain('持剑者')
    expect(map.get('test:ach')).toContain('sword') // 存档含成就

    // 战斗到结局 → 返回标题 → 清除存档
    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[0]).click() // 战斗
    ;(root.querySelector('[data-action="title"]') as HTMLButtonElement).click()
    ;(root.querySelector('[data-action="clear"]') as HTMLButtonElement).click()

    // 空手路线解锁隐藏成就后，列表画面显示其名称
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[1]).click() // 空手
    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[1]).click() // 求饶 → 真相结局
    ;(root.querySelector('[data-action="title"]') as HTMLButtonElement).click()
    ;(root.querySelector('[data-action="achievements"]') as HTMLButtonElement).click()
    const titles = [...root.querySelectorAll('.ach-title')].map((el) => el.textContent)
    expect(titles).toContain('隐藏成就')
    expect(titles).toContain('持剑者')
  })
})

describe('文本块与线索夹', () => {
  /** 带文档与 blocks 的剧情 */
  function makeDocStory() {
    const story = makeStory()
    story.documents = {
      d_rules: {
        id: 'd_rules',
        title: '游客守则',
        kind: 'rules',
        text: '1. 兔子不会发出笑声。\n2. 若听见笑声，请离开。',
      },
      d_note: { id: 'd_note', title: '纸条', kind: 'note', text: '别相信员工手册。' },
    }
    // 用 blocks 渲染 start
    story.nodes.start.text = ''
    story.nodes.start.blocks = [
      { type: 'title', title: '动物园入口', text: '动物园入口' },
      { type: 'rules', title: '游客守则（节选）', text: '1. 兔子不会发出笑声。\n2. 不要喂食兔子。' },
      { type: 'note', text: '（地上捡到的纸条，字迹潦草）' },
    ]
    story.nodes.start.choices = [
      { label: '捡起地上的守则', target: 'armed', effects: { gainDocs: ['d_rules'] } },
      { label: '捡起纸条', target: 'unarmed', effects: { gainDocs: ['d_note'] } },
    ]
    return story
  }

  it('blocks 分类型渲染（title/rules/note）', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage } = memoryStorage()
    mountTextAdventure(root, makeDocStory(), { saveKey: 'test:blocks', storage })
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()

    expect(root.querySelector('.block-title')?.textContent).toBe('动物园入口')
    const rules = root.querySelector('.block-rules .block-body')?.textContent
    expect(rules).toContain('1. 兔子不会发出笑声')
    expect(root.querySelector('.block-note')).not.toBeNull()
  })

  it('受控富文本按条件隐藏并在获得证据后揭示', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage } = memoryStorage()
    const story = makeStory()
    story.evidence = {
      e_time: { id: 'e_time', title: '停摆的钟', description: '停在凌晨三点。' },
    }
    story.nodes.start.blocks = [{
      type: 'para',
      text: '病历写着：凌晨三点。',
      segments: [
        { text: '病历写着：' },
        { text: '凌晨三点', style: 'redacted', revealWhen: { op: 'eq', var: '#evidence', value: 'e_time' } },
        { text: '。血迹未干。', style: 'blood' },
        { text: ' SIGNAL LOST ', style: 'broadcast' },
      ],
    }]
    story.nodes.start.choices.unshift({
      label: '检查停摆的钟', target: 'start', effects: { gainEvidence: ['e_time'] },
    })

    mountTextAdventure(root, story, { saveKey: 'test:segments', storage })
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
    expect(root.querySelector('.segment-redacted')?.textContent).not.toContain('凌晨三点')
    expect(root.querySelector('.segment-redacted')?.getAttribute('aria-label')).toBe('内容尚未揭示')
    expect(root.querySelector('.segment-blood')?.textContent).toContain('血迹未干')
    expect(root.querySelector('.segment-broadcast')?.textContent).toContain('SIGNAL LOST')

    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[0]).click()
    expect(root.querySelector('.segment-revealed')?.textContent).toContain('凌晨三点')
    expect(root.querySelector('.segment-redacted')).toBeNull()
  })

  it('获得线索后出现入口，可打开线索夹查看详情并返回', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage } = memoryStorage()
    mountTextAdventure(root, makeDocStory(), { saveKey: 'test:docs', storage })

    // 开始游戏前无线索按钮
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
    expect(root.querySelector('[data-action="docs"]')).toBeNull()

    // 捡守则 → 线索按钮出现
    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[0]).click()
    const docsBtn = root.querySelector<HTMLButtonElement>('[data-action="docs"]')
    expect(docsBtn).not.toBeNull()
    expect(docsBtn?.textContent).toContain('线索 1')

    // 打开线索夹
    docsBtn!.click()
    expect(root.querySelector('.doc-item')?.textContent).toContain('游客守则')
    expect(root.querySelector('.doc-kind')?.textContent).toBe('守则')

    // 查看详情
    ;(root.querySelector<HTMLButtonElement>('[data-doc]')!).click()
    expect(root.querySelector('.block-head')?.textContent).toBe('游客守则')
    expect(root.querySelector('.block-body')?.textContent).toContain('兔子不会发出笑声')

    // 返回列表 → 返回游戏
    ;(root.querySelector('[data-action="back"]') as HTMLButtonElement).click()
    expect(root.querySelector('.doc-item')).not.toBeNull()
    ;(root.querySelector('[data-action="back"]') as HTMLButtonElement).click()
    expect(root.querySelector('.choice-btn')).not.toBeNull()
  })

  it('无文档剧情不显示线索入口', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage } = memoryStorage()
    mountTextAdventure(root, makeStory(), { saveKey: 'test:nodocs', storage })
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[0]).click()
    expect(root.querySelector('[data-action="docs"]')).toBeNull()
  })

  it('unstable 不稳定灯：随机间隔触发连闪爆发后移除', () => {
    vi.useFakeTimers()
    // 控制随机数：delay = 2000 + random*3000 → 固定 2000ms，便于分步推进
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const story = makeStory()
    story.nodes.start.fx = [{ name: 'unstable', intensity: 0.5, speed: 1 }]
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage } = memoryStorage()
    mountTextAdventure(root, story, { saveKey: 'test:unstable', storage })
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()

    const card = root.querySelector<HTMLElement>('.card')!
    expect(card.className).toContain('fx-unstable')
    expect(card.getAttribute('style')).toContain('--fx-burst-min: 0.60')

    // 初始未触发爆发
    expect(card.classList.contains('fx-burst')).toBe(false)

    // 第一轮：delay=2000 到达 → 连闪爆发出现
    vi.advanceTimersByTime(2000)
    expect(card.classList.contains('fx-burst')).toBe(true)

    // 爆发动画结束（~0.58s）→ 移除
    vi.advanceTimersByTime(600)
    expect(card.classList.contains('fx-burst')).toBe(false)

    // 下一轮随机等待仍在排程（schedule 递归）
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    randomSpy.mockRestore()
    vi.useRealTimers()
  })

  it('节点 fx 动画 class 生效，mute 按钮可切换', () => {
    const story = makeStory()
    story.nodes.start.fx = [
      'shake', // 字符串：默认参数
      { name: 'flicker', intensity: 0.3, speed: 2 }, // 参数化：轻微闪烁 + 快一倍
    ]
    story.nodes.start.sfx = 'heartbeat' // 无 AudioContext 环境应静默不抛错
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage } = memoryStorage()
    mountTextAdventure(root, story, { saveKey: 'test:fx', storage })

    // 标题屏有 mute 按钮（默认 🔊）
    const titleMute = root.querySelector<HTMLElement>('[data-action="mute"]')
    expect(titleMute).not.toBeNull()
    expect(titleMute?.textContent).toBe('🔊')

    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
    // 卡片带 fx class
    const card = root.querySelector('.card')
    expect(card?.className).toContain('fx-shake')
    expect(card?.className).toContain('fx-flicker')
    // 参数化 fx：内联 CSS 变量控制幅度/频率
    const style = (card as HTMLElement)?.getAttribute('style') ?? ''
    expect(style).toContain('--fx-shake-amp: 3.0px') // shake 默认强度 1 → 3px
    expect(style).toContain('--fx-flicker-min: 0.80') // flicker intensity 0.3 → 最低亮度 0.80（轻微闪烁）
    expect(style).toContain('--fx-flicker-dur: 0.650s') // speed 2 → 周期减半
    // 游戏画面也有 mute 按钮
    const mute = root.querySelector<HTMLElement>('[data-action="mute"]')
    expect(mute).not.toBeNull()
    // 点击切换为静音
    mute!.click()
    expect(mute?.textContent).toBe('🔇')
    // 状态持久化
    expect(localStorage.getItem('ate:sfx:muted')).toBe('1')
    // 再点恢复
    mute!.click()
    expect(mute?.textContent).toBe('🔊')
  })
})

describe('证据推理板', () => {
  it('玩家组合已获得证据形成推论，返回场景后看到新选项', () => {
    const story = makeStory()
    story.evidence = {
      clock: { id: 'clock', title: '停住的时钟', description: '停在 22:10。', kind: 'observation' },
      testimony: { id: 'testimony', title: '女仆证词', description: '管家 22:20 才回来。', kind: 'testimony' },
    }
    story.deductions = {
      false_alibi: {
        id: 'false_alibi', statement: '管家的不在场证明不成立',
        hint: '继续调查时钟，并争取目击者开口。',
        requires: { all: ['clock', 'testimony'] },
      },
    }
    story.nodes.start.objective = '查明管家的不在场证明是否可信'
    story.nodes.start.onEnter = { gainEvidence: ['clock', 'testimony'] }
    story.nodes.start.choices.unshift({
      label: '揭穿管家', target: 'fight',
      when: { op: 'eq', var: '#deduction', value: 'false_alibi' },
    })

    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage } = memoryStorage()
    mountTextAdventure(root, story, { saveKey: 'test:deduction-board', storage })
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()

    expect(root.querySelector('.scene-objective')?.textContent).toContain('查明管家的不在场证明')
    expect(root.querySelector('[data-tutorial="deduction"]')?.textContent).toContain('推理板')
    ;(root.querySelector('[data-action="dismiss-tutorial"]') as HTMLButtonElement).click()
    expect(root.querySelector('[data-tutorial="deduction"]')).toBeNull()
    expect([...root.querySelectorAll('.choice-btn')].map((el) => el.textContent)).not.toContain('揭穿管家')
    const deductionAction = root.querySelector<HTMLElement>('[data-deduction-choice]')
    expect(deductionAction?.textContent).toContain('整理线索并推理')
    deductionAction!.click()
    expect(root.querySelectorAll('[data-evidence]').length).toBe(2)
    expect(root.querySelector('[data-deduction="false_alibi"]')?.textContent).toContain('管家的不在场证明不成立')
    expect(root.querySelector('.deduction-guide')?.textContent).toContain('勾选支持它的证据')
    expect(root.querySelector('[data-deduction-progress="false_alibi"]')?.textContent).toContain('必需证据 2/2')
    expect(root.querySelector('[data-deduction-hint="false_alibi"]')?.textContent).toContain('继续调查时钟')

    root.querySelectorAll<HTMLInputElement>('[data-evidence]').forEach((input) => input.click())
    ;(root.querySelector('[data-action="confirm-deduction"]') as HTMLButtonElement).click()
    expect(root.querySelector('[data-deduction-result]')?.textContent).toContain('推论成立')

    ;(root.querySelector('[data-action="back"]') as HTMLButtonElement).click()
    expect([...root.querySelectorAll('.choice-btn')].map((el) => el.textContent)).toContain('揭穿管家')
  })

  it('获得新证据时明确提示已加入推理板，首次教学状态随存档恢复', () => {
    const story = makeStory()
    story.evidence = {
      clock: { id: 'clock', title: '停住的时钟', description: '停在十点。' },
    }
    story.deductions = {
      truth: { id: 'truth', statement: '时钟被人为停下', requires: { all: ['clock'] } },
    }
    story.nodes.armed.onEnter = { gainEvidence: ['clock'] }
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage } = memoryStorage()
    mountTextAdventure(root, story, { saveKey: 'test:evidence-notice', storage })
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()
    ;(root.querySelectorAll<HTMLButtonElement>('[data-choice]')[0]).click()

    expect(root.querySelector('.evidence-notice')?.textContent).toContain('停住的时钟')
    expect(root.querySelector('.evidence-notice')?.textContent).toContain('已加入推理板')
    expect(root.querySelector('[data-tutorial="deduction"]')).not.toBeNull()
    ;(root.querySelector('[data-action="dismiss-tutorial"]') as HTMLButtonElement).click()

    root.innerHTML = ''
    mountTextAdventure(root, story, { saveKey: 'test:evidence-notice', storage })
    ;(root.querySelector('[data-action="continue"]') as HTMLButtonElement).click()
    expect(root.querySelector('[data-tutorial="deduction"]')).toBeNull()
  })
})

describe('人物关系页', () => {
  it('玩家查看关系与秘密状态，揭示秘密后仍可从结局返回人物页查看', () => {
    const story = makeStory()
    story.characters = {
      maid: {
        id: 'maid', name: '林夏', description: '山庄女仆。',
        relations: { trust: { label: '信任', initial: 0, min: -3, max: 3 } },
        secrets: {
          corridor: { id: 'corridor', title: '隐藏走廊', description: '她看见管家进入隐藏走廊。' },
        },
      },
    }
    story.nodes.start.choices = [{
      label: '替她保密', target: 'fight',
      effects: {
        adjustRelation: [{ characterId: 'maid', stat: 'trust', add: 2 }],
        remember: ['protected_maid'],
      },
    }]
    story.nodes.fight.onEnter = { revealSecrets: ['maid:corridor'] }

    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage } = memoryStorage()
    mountTextAdventure(root, story, { saveKey: 'test:characters', storage })
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()

    ;(root.querySelector('[data-action="characters"]') as HTMLButtonElement).click()
    expect(root.querySelector('[data-character="maid"]')?.textContent).toContain('林夏')
    expect(root.querySelector('[data-character="maid"]')?.textContent).toContain('信任 0')
    expect(root.querySelector('[data-secret="maid:corridor"]')?.textContent).toContain('未知秘密')
    ;(root.querySelector('[data-action="back"]') as HTMLButtonElement).click()

    ;(root.querySelector('[data-choice]') as HTMLButtonElement).click()
    expect(root.querySelector('.ending-title')).not.toBeNull()
    ;(root.querySelector('[data-action="characters"]') as HTMLButtonElement).click()
    expect(root.querySelector('[data-character="maid"]')?.textContent).toContain('信任 2')
    expect(root.querySelector('[data-secret="maid:corridor"]')?.textContent).toContain('隐藏走廊')
    expect(root.querySelector('[data-secret="maid:corridor"]')?.textContent).toContain('她看见管家进入隐藏走廊')
    ;(root.querySelector('[data-action="back"]') as HTMLButtonElement).click()
    expect(root.querySelector('.ending-title')).not.toBeNull()
  })
})

describe('密码谜题页', () => {
  it('玩家提交答案、查看渐进提示，解开后返回场景看到新选项', () => {
    const story = makeStory()
    story.puzzles = {
      safe: {
        id: 'safe', title: '书房保险箱', prompt: '输入四位密码。', kind: 'code',
        solution: '2210', actionLabel: '尝试打开保险箱',
        hints: ['观察时钟。', '按小时和分钟组合。'],
      },
    }
    story.nodes.start.puzzles = ['safe']
    story.nodes.start.choices.unshift({
      label: '打开保险箱', target: 'fight',
      when: { op: 'eq', var: '#puzzle', value: 'safe' },
    })
    const root = document.createElement('div')
    document.body.appendChild(root)
    const { storage } = memoryStorage()
    mountTextAdventure(root, story, { saveKey: 'test:puzzle', storage })
    ;(root.querySelector('[data-action="start"]') as HTMLButtonElement).click()

    expect([...root.querySelectorAll('.choice-btn')].map((el) => el.textContent)).not.toContain('打开保险箱')
    expect([...root.querySelectorAll('[data-puzzle-choice]')].map((el) => el.textContent)).toEqual([
      '尝试打开保险箱',
    ])
    ;(root.querySelector('[data-puzzle-choice="safe"]') as HTMLButtonElement).click()
    expect(root.querySelector('[data-puzzle="safe"]')?.textContent).toContain('书房保险箱')

    const answer = root.querySelector<HTMLInputElement>('[data-puzzle-answer="safe"]')!
    answer.value = '1234'
    ;(root.querySelector('[data-action="attempt-puzzle"]') as HTMLButtonElement).click()
    expect(root.querySelector('[data-puzzle-result]')?.textContent).toContain('答案不正确')
    expect(root.querySelector('[data-puzzle-result]')?.textContent).toContain('1 次')

    ;(root.querySelector('[data-action="puzzle-hint"]') as HTMLButtonElement).click()
    expect(root.querySelector('[data-puzzle-hints]')?.textContent).toContain('观察时钟')

    root.querySelector<HTMLInputElement>('[data-puzzle-answer="safe"]')!.value = '2210'
    ;(root.querySelector('[data-action="attempt-puzzle"]') as HTMLButtonElement).click()
    expect(root.querySelector('[data-puzzle-result]')?.textContent).toContain('谜题已解开')
    ;(root.querySelector('[data-action="back"]') as HTMLButtonElement).click()
    expect([...root.querySelectorAll('.choice-btn')].map((el) => el.textContent)).toContain('打开保险箱')
  })
})
