import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { StoryNode } from '../core/types.js'
import * as projects from './projects.js'
import * as handlers from './handlers.js'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'ate-mcp-'))
  projects.setProjectsRoot(tmp)
})

afterEach(async () => {
  await projects.deleteProject('测试游戏').catch(() => {})
})

async function createTestProject(title = '测试游戏'): Promise<void> {
  await handlers.newProject({ title })
}

describe('story_new', () => {
  it('创建骨架项目并落盘 story.json', async () => {
    const res = (await handlers.newProject({ title: '测试游戏', subtitle: '副标题' })) as {
      existed: boolean
      path: string
    }
    expect(res.existed).toBe(false)
    const raw = await readFile(res.path, 'utf-8')
    const story = JSON.parse(raw)
    expect(story.meta.title).toBe('测试游戏')
    expect(story.nodes.start).toBeDefined()
  })

  it('重复创建返回 existed 且不覆盖', async () => {
    await createTestProject()
    const res = (await handlers.newProject({ title: '测试游戏' })) as { existed: boolean }
    expect(res.existed).toBe(true)
  })

  it('空标题报错', async () => {
    await expect(handlers.newProject({ title: '  ' })).rejects.toThrow('title 不能为空')
  })
})

describe('story_upsert_node / delete_node', () => {
  it('新增节点后返回校验结果（孤立节点报不可达，接入主线后通过）', async () => {
    await createTestProject()
    const node: StoryNode = {
      id: 'second',
      text: '第二节点',
      choices: [{ label: '前往结局', target: 'end' }],
    }
    const res = (await handlers.upsertNode({ title: '测试游戏', node })) as {
      created: boolean
      validate: string[]
    }
    expect(res.created).toBe(true)
    // 新节点尚未被任何节点引用 → 校验报告不可达
    expect(res.validate.join('\n')).toContain('节点 "second" 不可达')

    // 把 start 的选项指向 second，接入主线后校验通过
    const story = (await handlers.getStory('测试游戏')) as { story: { nodes: Record<string, StoryNode> } }
    const start = { ...story.story.nodes.start }
    start.choices = [{ label: '去第二节点', target: 'second' }]
    const res2 = (await handlers.upsertNode({ title: '测试游戏', node: start })) as {
      validatePass: boolean
    }
    expect(res2.validatePass).toBe(true)
  })

  it('写入前拒绝缺少 text 的节点，且不会损坏已有项目', async () => {
    await createTestProject()
    const invalidNode = {
      id: 'blocks-only',
      blocks: [{ type: 'para', text: '只有文本块' }],
      choices: [{ label: '返回', target: 'start' }],
    }

    await expect(
      handlers.upsertNode({ title: '测试游戏', node: invalidNode as unknown as StoryNode }),
    ).rejects.toThrow(/text/)

    await expect(handlers.getStory('测试游戏')).resolves.toMatchObject({
      story: { nodes: { start: { id: 'start' } } },
    })
  })

  it('拒绝节点顶层未知字段，不再静默丢弃 effects', async () => {
    await createTestProject()
    const invalidNode = {
      id: 'silent-effects',
      text: '错误效果位置',
      choices: [{ label: '返回', target: 'start' }],
      effects: { set: { trust: 10 } },
    }

    await expect(
      handlers.upsertNode({ title: '测试游戏', node: invalidNode as unknown as StoryNode }),
    ).rejects.toThrow(/effects|未知字段/)

    const result = await handlers.getStory('测试游戏') as { story: { nodes: Record<string, StoryNode> } }
    expect(result.story.nodes['silent-effects']).toBeUndefined()
  })

  it('写入前拒绝未知音效和越界动画参数', async () => {
    await createTestProject()
    const base = {
      id: 'unsafe-presentation', text: '不安全演出',
      choices: [{ label: '返回', target: 'start' }],
    }

    await expect(handlers.upsertNode({
      title: '测试游戏', node: { ...base, sfx: 'explosion' } as unknown as StoryNode,
    })).rejects.toThrow(/sfx|explosion/)
    await expect(handlers.upsertNode({
      title: '测试游戏', node: {
        ...base, fx: [{ name: 'shake', intensity: 2.1 }],
      } as StoryNode,
    })).rejects.toThrow(/intensity/)
    await expect(handlers.upsertNode({
      title: '测试游戏', node: {
        ...base, fx: [{ name: 'flicker', speed: 4.1 }],
      } as StoryNode,
    })).rejects.toThrow(/speed/)
    await expect(handlers.upsertNode({
      title: '测试游戏', node: {
        ...base, soundscape: { name: 'custom_mp3', intensity: 'medium' },
      } as unknown as StoryNode,
    })).rejects.toThrow(/soundscape|custom_mp3/)
    await expect(handlers.upsertNode({
      title: '测试游戏', node: {
        ...base, soundscape: { name: 'rain', intensity: 'overwhelming' },
      } as unknown as StoryNode,
    })).rejects.toThrow(/intensity|overwhelming/)
    await expect(handlers.upsertNode({
      title: '测试游戏', node: {
        ...base, stage: { backdrop: 'custom_image', actors: [] },
      } as unknown as StoryNode,
    })).rejects.toThrow(/backdrop|custom_image/)
    await expect(handlers.upsertNode({
      title: '测试游戏', node: {
        ...base,
        stage: {
          actors: [
            { characterId: 'a', position: 'left' },
            { characterId: 'b', position: 'center' },
            { characterId: 'c', position: 'right' },
            { characterId: 'd', position: 'left' },
          ],
        },
      } as unknown as StoryNode,
    })).rejects.toThrow(/actors|too_big|3/)
  })

  it('写入前拒绝未知富文本样式与任意 HTML 字段', async () => {
    await createTestProject()
    const base = {
      id: 'unsafe-segment', text: '不安全富文本',
      choices: [{ label: '返回', target: 'start' }],
    }

    await expect(handlers.upsertNode({
      title: '测试游戏', node: {
        ...base,
        blocks: [{ type: 'para', text: '回退', segments: [{ text: '彩虹', style: 'rainbow' }] }],
      } as unknown as StoryNode,
    })).rejects.toThrow(/style|rainbow/)
    await expect(handlers.upsertNode({
      title: '测试游戏', node: {
        ...base,
        blocks: [{ type: 'para', text: '回退', segments: [{ text: '危险', html: '<script />' }] }],
      } as unknown as StoryNode,
    })).rejects.toThrow(/html|未知字段/)
  })

  it('删除被引用的节点会报错并列出引用处', async () => {
    await createTestProject()
    // start 引用了 end
    await expect(handlers.deleteNode({ title: '测试游戏', nodeId: 'end' })).rejects.toThrow(
      /仍被 1 处引用.*start.*看看这个示例结局/,
    )
  })

  it('force 删除后产生断链并在校验中报告', async () => {
    await createTestProject()
    const res = (await handlers.deleteNode({
      title: '测试游戏',
      nodeId: 'end',
      force: true,
    })) as { deleted: boolean; validate: string[] }
    expect(res.deleted).toBe(true)
    expect(res.validate.join('\n')).toContain('指向不存在的节点 "end"')
  })

  it('结局表清理：先删节点再删结局', async () => {
    await createTestProject()
    // end 节点仍使用 e_end → 直接删结局报错
    await expect(
      handlers.deleteEnding({ title: '测试游戏', endingId: 'e_end' }),
    ).rejects.toThrow(/仍被节点使用.*end/)
    // 删除节点后结局可删
    await handlers.deleteNode({ title: '测试游戏', nodeId: 'end', force: true })
    const res = (await handlers.deleteEnding({ title: '测试游戏', endingId: 'e_end' })) as {
      deleted: boolean
      validatePass: boolean
    }
    expect(res.deleted).toBe(true)
    expect(res.validatePass).toBe(false) // start 选项仍指向已删的 end
  })
})

describe('story_validate / story_walk', () => {
  it('骨架项目校验通过且全路径覆盖', async () => {
    await createTestProject()
    const res = (await handlers.validateStory('测试游戏')) as {
      validatePass: boolean
      walk: { endings: { endingId: string }[] }
    }
    expect(res.validatePass).toBe(true)
    expect(res.walk.endings.map((e) => e.endingId)).toEqual(['e_end'])
  })

  it('story_walk 接受预算参数并返回热点诊断', async () => {
    await createTestProject()
    const res = (await handlers.walkStory({
      title: '测试游戏',
      maxStates: 1,
      witnessMaxStates: 10,
      diagnostics: true,
      topNodes: 1,
    })) as {
      walk: {
        truncated: boolean
        budget: { used: number; limit: number; utilization: number }
        hotNodes?: { nodeId: string; visits: number }[]
        coverage: { complete: boolean; reasons: string[] }
        reachability: {
          allEndingsProven: boolean
          witnesses: Array<{ endingId: string; source: string; actions: unknown[] }>
          witnessSearch: { limitPerEnding: number }
        }
      }
    }

    expect(res.walk.truncated).toBe(true)
    expect(res.walk.budget.limit).toBe(1)
    expect(res.walk.hotNodes).toHaveLength(1)
    expect(res.walk.coverage).toEqual({ complete: false, reasons: ['state_budget'] })
    expect(res.walk.reachability.allEndingsProven).toBe(true)
    expect(res.walk.reachability.witnesses[0]).toMatchObject({ endingId: 'e_end', source: 'targeted' })
    expect(res.walk.reachability.witnessSearch.limitPerEnding).toBe(10)
  })

  it('紧凑 validate/walk 保留结论并省略见证动作', async () => {
    await createTestProject()
    const validated = (await handlers.validateStory({ title: '测试游戏', compact: true })) as {
      compact: boolean
      walk: { reachability: { witnesses: Array<{ actions?: unknown[] }> } }
    }
    const walked = (await handlers.walkStory({ title: '测试游戏', compact: true })) as {
      compact: boolean
      walk: { reachability: { witnesses: Array<{ actions?: unknown[] }> } }
    }

    expect(validated.compact).toBe(true)
    expect(validated.walk.reachability.witnesses[0].actions).toBeUndefined()
    expect(walked.compact).toBe(true)
    expect(walked.walk.reachability.witnesses[0].actions).toBeUndefined()
  })

  it('紧凑 evaluate 省略内嵌 walk 的见证动作', async () => {
    await createTestProject()
    const evaluated = (await handlers.evaluateProject({ title: '测试游戏', compact: true })) as {
      evaluation: { performance: { walk: { reachability: { witnesses: Array<{ actions?: unknown[] }> } } } }
    }

    expect(evaluated.evaluation.performance.walk.reachability.witnesses[0].actions).toBeUndefined()
  })

  it('断链剧情校验失败并给出问题列表', async () => {
    await createTestProject()
    const node: StoryNode = {
      id: 'broken',
      text: '断链',
      choices: [{ label: '去不存在', target: 'ghost' }],
    }
    await handlers.upsertNode({ title: '测试游戏', node })
    const res = (await handlers.validateStory('测试游戏')) as {
      validatePass: boolean
      problems: string[]
      experienceWarnings: string[]
    }
    expect(res.validatePass).toBe(false)
    expect(res.problems.join('\n')).toContain('"ghost"')
    expect(Array.isArray(res.experienceWarnings)).toBe(true)
  })
})

describe('story_graph', () => {
  it('输出 mermaid flowchart', async () => {
    await createTestProject()
    const res = (await handlers.graph('测试游戏')) as { mermaid: string }
    expect(res.mermaid.startsWith('flowchart TD')).toBe(true)
    expect(res.mermaid).toContain('start -->')
  })
})

describe('story_export', () => {
  it('校验通过时导出单文件 HTML', async () => {
    await createTestProject()
    const res = (await handlers.exportStory({ title: '测试游戏' })) as {
      ok: boolean
      outputPath: string
    }
    expect(res.ok).toBe(true)
    const html = await readFile(res.outputPath, 'utf-8')
    expect(html).toContain('<title>测试游戏</title>')
    expect(html).toContain('TextAdventure.mountTextAdventure')
  })

  it('校验不通过时拒绝导出', async () => {
    await createTestProject()
    await handlers.deleteNode({ title: '测试游戏', nodeId: 'end', force: true })
    const res = (await handlers.exportStory({ title: '测试游戏' })) as { ok: boolean }
    expect(res.ok).toBe(false)
  })
})

describe('story_list / set_meta / delete_project', () => {
  it('列表与元信息更新', async () => {
    await createTestProject()
    await handlers.setMeta({
      title: '测试游戏', subtitle: '新副标题',
      soundscape: { name: 'rain', intensity: 'subtle' },
      world: {
        initial: 'surface',
        states: { surface: { label: '表世界' }, other: { theme: 'cyber' } },
      },
      phase: {
        initial: 'day',
        states: { day: {}, night: { presentation: { typography: 'mono' } } },
      },
    })
    const list = (await handlers.listProjects()) as { projects: { title: string }[] }
    expect(list.projects.some((p) => p.title === '测试游戏')).toBe(true)
    const story = await projects.loadStory('测试游戏')
    expect(story.meta.subtitle).toBe('新副标题')
    expect(story.meta.soundscape).toEqual({ name: 'rain', intensity: 'subtle' })
    expect(story.meta.world?.initial).toBe('surface')
    expect(story.meta.phase?.states.night.presentation?.typography).toBe('mono')
  })

  it('用一次短配置更新作品视觉表达', async () => {
    await createTestProject()
    await handlers.setPresentation({
      title: '测试游戏',
      presentation: {
        shell: 'chat', typography: 'rounded', density: 'compact',
        shape: 'round', choiceStyle: 'dialogue',
      },
    })
    const story = await projects.loadStory('测试游戏')
    expect(story.meta.presentation).toEqual({
      shell: 'chat', typography: 'rounded', density: 'compact',
      shape: 'round', choiceStyle: 'dialogue',
    })
  })

  it('删除项目后列表为空', async () => {
    await createTestProject()
    await handlers.deleteProject('测试游戏')
    const list = (await handlers.listProjects()) as { projects: unknown[] }
    expect(list.projects).toHaveLength(0)
  })
})

describe('story_upsert_document / delete_document', () => {
  it('新增文档并可在剧情中校验通过', async () => {
    await createTestProject()
    const res = (await handlers.upsertDocument({
      title: '测试游戏',
      document: {
        id: 'd_rules',
        title: '游客守则',
        kind: 'rules',
        text: '1. 兔子不会发出笑声。',
      },
    })) as { created: boolean; validatePass: boolean }
    expect(res.created).toBe(true)
    expect(res.validatePass).toBe(true)
  })

  it('删除不存在的文档返回 deleted:false', async () => {
    await createTestProject()
    const res = (await handlers.deleteDocument({
      title: '测试游戏',
      documentId: 'ghost',
    })) as { deleted: boolean }
    expect(res.deleted).toBe(false)
  })

  it('删除文档后校验报告引用残留（若节点 gainDocs 仍引用）', async () => {
    await createTestProject()
    // 先建文档 + 让 start 节点引用它
    await handlers.upsertDocument({
      title: '测试游戏',
      document: { id: 'd_x', title: '纸条', text: '内容' },
    })
    const story = (await handlers.getStory('测试游戏')) as { story: { nodes: Record<string, StoryNode> } }
    const start = { ...story.story.nodes.start }
    start.onEnter = { gainDocs: ['d_x'] }
    await handlers.upsertNode({ title: '测试游戏', node: start })
    // 删除文档 → 校验报告 gainDocs 引用不存在
    const res = (await handlers.deleteDocument({ title: '测试游戏', documentId: 'd_x' })) as {
      deleted: boolean
      validatePass: boolean
      validate: string[]
    }
    expect(res.deleted).toBe(true)
    expect(res.validatePass).toBe(false)
    expect(res.validate.join('\n')).toContain('不存在的文档 "d_x"')
  })
})

describe('story_evaluate', () => {
  it('通过 MCP handler 返回结构化评估且不打总分', async () => {
    await createTestProject()
    const res = (await handlers.evaluateProject('测试游戏')) as {
      ok: boolean
      evaluationScope: string
      evaluation: { summary: { nodes: number }; findings: unknown[]; score?: number }
    }
    expect(res.ok).toBe(true)
    expect(res.evaluationScope).toBe('quick_diagnostic')
    expect(res.evaluation.summary.nodes).toBe(2)
    expect(Array.isArray(res.evaluation.findings)).toBe(true)
    expect(res.evaluation.score).toBeUndefined()
  })
})

describe('story_upsert_evidence / story_upsert_deduction', () => {
  it('Agent 可幂等定义证据和推论，并从 story_get 读回', async () => {
    await createTestProject()
    const evidence = {
      id: 'clock', title: '停住的时钟', description: '停在 22:10。', kind: 'observation' as const,
    }
    const deduction = {
      id: 'false_alibi', statement: '不在场证明不成立', requires: { all: ['clock'] },
    }

    const first = await handlers.upsertEvidence({ title: '测试游戏', evidence }) as { created: boolean }
    const second = await handlers.upsertEvidence({ title: '测试游戏', evidence }) as { created: boolean }
    const ded = await handlers.upsertDeduction({ title: '测试游戏', deduction }) as { created: boolean }
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(ded.created).toBe(true)

    const result = await handlers.getStory('测试游戏') as {
      story: { evidence?: Record<string, unknown>; deductions?: Record<string, unknown> }
    }
    expect(result.story.evidence?.clock).toEqual(evidence)
    expect(result.story.deductions?.false_alibi).toEqual(deduction)
  })
})

describe('增量节点读取 / 转场审查 / 选项补丁', () => {
  it('读取单个节点及入边，不返回整部 story 包装', async () => {
    await createTestProject()
    const result = await handlers.getNode({ title: '测试游戏', nodeId: 'end' }) as {
      node: StoryNode
      incoming: Array<{ sourceNodeId: string; choiceIndex: number; label: string; response?: string }>
      story?: unknown
    }
    expect(result.node.id).toBe('end')
    expect(result.incoming).toEqual([{
      sourceNodeId: 'start', choiceIndex: 0, label: '看看这个示例结局', response: undefined,
    }])
    expect(result.story).toBeUndefined()
  })

  it('分页审查转场，并用旧值断言安全地局部补充 response', async () => {
    await createTestProject()
    const review = await handlers.reviewProjectTransitions({ title: '测试游戏', limit: 1 }) as {
      review: { items: Array<{ choiceIndex: number; label: string; targetNodeId: string }>; nextCursor: number | null }
    }
    expect(review.review.items[0]).toMatchObject({
      choiceIndex: 0, label: '看看这个示例结局', targetNodeId: 'end',
    })

    const patched = await handlers.patchChoice({
      title: '测试游戏', nodeId: 'start', choiceIndex: 0,
      expectedLabel: '看看这个示例结局', expectedTarget: 'end',
      patch: { response: '你翻到故事的最后一页。' },
    }) as { choice: { response?: string }; validatePass: boolean }
    expect(patched.choice.response).toBe('你翻到故事的最后一页。')
    expect(patched.validatePass).toBe(true)

    const saved = await handlers.getNode({ title: '测试游戏', nodeId: 'start' }) as { node: StoryNode }
    expect(saved.node.choices[0].response).toBe('你翻到故事的最后一页。')
  })

  it('过期断言拒绝误改，并允许 null 删除可选字段', async () => {
    await createTestProject()
    await expect(handlers.patchChoice({
      title: '测试游戏', nodeId: 'start', choiceIndex: 0,
      expectedLabel: '已经变化的旧文案', patch: { response: '不应写入' },
    })).rejects.toMatchObject({ code: 'CONFLICT' })

    await handlers.patchChoice({
      title: '测试游戏', nodeId: 'start', choiceIndex: 0,
      expectedLabel: '看看这个示例结局', patch: { response: '临时承接' },
    })
    const removed = await handlers.patchChoice({
      title: '测试游戏', nodeId: 'start', choiceIndex: 0,
      expectedLabel: '看看这个示例结局', patch: { response: null },
    }) as { choice: { response?: string } }
    expect(removed.choice).not.toHaveProperty('response')
  })
})

describe('story_upsert_character / story_delete_character', () => {
  it('Agent 可幂等定义包含关系维度和秘密的人物', async () => {
    await createTestProject()
    const character = {
      id: 'maid', name: '林夏', description: '山庄女仆。',
      relations: { trust: { label: '信任', initial: 0, min: -3, max: 3 } },
      secrets: { corridor: { id: 'corridor', title: '隐藏走廊', description: '她看见了走廊。' } },
    }
    const first = await handlers.upsertCharacter({ title: '测试游戏', character }) as { created: boolean }
    const second = await handlers.upsertCharacter({ title: '测试游戏', character }) as { created: boolean }
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    const result = await handlers.getStory('测试游戏') as { story: { characters?: Record<string, unknown> } }
    expect(result.story.characters?.maid).toEqual(character)
  })
})

describe('story_upsert_puzzle / story_delete_puzzle', () => {
  it('Agent 可幂等定义带提示和成功效果的密码谜题', async () => {
    await createTestProject()
    const puzzle = {
      id: 'safe', title: '保险箱', prompt: '输入四位密码', kind: 'code' as const,
      solution: '2210', hints: ['观察时钟'], onSolved: { flag: { safe_open: true } },
    }
    const first = await handlers.upsertPuzzle({ title: '测试游戏', puzzle }) as { created: boolean }
    const second = await handlers.upsertPuzzle({ title: '测试游戏', puzzle }) as { created: boolean }
    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    const result = await handlers.getStory('测试游戏') as { story: { puzzles?: Record<string, unknown> } }
    expect(result.story.puzzles?.safe).toEqual(puzzle)
  })
})
