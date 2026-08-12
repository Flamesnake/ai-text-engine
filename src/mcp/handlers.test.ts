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
    }
    expect(res.validatePass).toBe(false)
    expect(res.problems.join('\n')).toContain('"ghost"')
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
    await handlers.setMeta({ title: '测试游戏', subtitle: '新副标题' })
    const list = (await handlers.listProjects()) as { projects: { title: string }[] }
    expect(list.projects.some((p) => p.title === '测试游戏')).toBe(true)
    const story = await projects.loadStory('测试游戏')
    expect(story.meta.subtitle).toBe('新副标题')
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
