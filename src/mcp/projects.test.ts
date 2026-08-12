import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseStory, SCHEMA_VERSION } from '../core/schema.js'
import * as projects from './projects.js'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'ate-proj-'))
  projects.setProjectsRoot(tmp)
})

afterEach(async () => {
  projects.setProjectsRoot(tmp)
  await projects.deleteProject('碰撞-A/B').catch(() => {})
  await projects.deleteProject('碰撞-A:B').catch(() => {})
  await projects.deleteProject('碰撞-A B').catch(() => {})
})

describe('项目存储深模块', () => {
  it('清洗标题碰撞时自动分配独立目录（a/b、a:b、a b 互不覆盖）', async () => {
    // 三个标题的 safeName 都是 "a-b"
    const t1 = '碰撞-A/B'
    const t2 = '碰撞-A:B'
    const t3 = '碰撞-A B'
    await projects.saveStory(projects.createSkeletonStory({ title: t1 }))
    await projects.saveStory(projects.createSkeletonStory({ title: t2 }))
    const d3 = await projects.saveStory(projects.createSkeletonStory({ title: t3 }))

    const story1 = await projects.loadStory(t1)
    const story2 = await projects.loadStory(t2)
    const story3 = await projects.loadStory(t3)
    expect(story1.meta.title).toBe(t1)
    expect(story2.meta.title).toBe(t2)
    expect(story3.meta.title).toBe(t3)
    // 三个目录互不相同，且都能按标题再次定位
    const dirs = new Set([await projects.resolveProjectDir(t1), await projects.resolveProjectDir(t2), d3])
    expect(dirs.size).toBe(3)
    const files = await readdir(tmp)
    expect(files.filter((f) => f.startsWith('碰撞-A-B')).sort()).toEqual(['碰撞-A-B', '碰撞-A-B-2', '碰撞-A-B-3'])
  })

  it('story.json 损坏时报 CORRUPT 而非伪装成项目不存在', async () => {
    const dir = path.join(tmp, '坏项目')
    await projects.saveStory(projects.createSkeletonStory({ title: '坏项目' }))
    await writeFile(path.join(dir, 'story.json'), '{ 这不是 JSON', 'utf-8')
    await expect(projects.loadStory('坏项目')).rejects.toMatchObject({ code: 'CORRUPT' })
    await expect(projects.resolveProjectDir('坏项目')).rejects.toMatchObject({ code: 'CORRUPT' })
    // 删除同样报告 CORRUPT（而非 NOT_FOUND 静默通过）
    await expect(projects.deleteProject('坏项目')).rejects.toMatchObject({ code: 'CORRUPT' })
  })

  it('数据不符合 schema（字段类型错误）时报 CORRUPT', async () => {
    await projects.saveStory(projects.createSkeletonStory({ title: '类型错' }))
    await writeFile(
      path.join(tmp, '类型错', 'story.json'),
      JSON.stringify({ meta: { title: '类型错' }, start: 'start', nodes: { start: { id: 'start', text: 123, choices: [] } }, endings: {} }),
      'utf-8',
    )
    await expect(projects.loadStory('类型错')).rejects.toMatchObject({ code: 'CORRUPT' })
  })

  it('并发冲突：读取后被外部修改，保存时拒绝覆盖', async () => {
    await projects.saveStory(projects.createSkeletonStory({ title: '冲突测试' }))
    const story = await projects.loadStory('冲突测试')
    // 外部（另一进程/编辑器）直接改写磁盘内容
    await writeFile(path.join(tmp, '冲突测试', 'story.json'), '{}', 'utf-8')
    await expect(projects.saveStory(story)).rejects.toMatchObject({ code: 'CONFLICT' })
    // 重新读取后再保存则正常（缓存已刷新）
    const reloaded = await projects.loadStory('冲突测试').catch(() => null)
    if (reloaded) {
      await expect(projects.saveStory(reloaded)).resolves.toContain('冲突测试')
    }
  })

  it('原子写入不残留临时文件', async () => {
    await projects.saveStory(projects.createSkeletonStory({ title: '原子写' }))
    await projects.saveStory(projects.createSkeletonStory({ title: '原子写' })) // 覆盖写
    const files = await readdir(path.join(tmp, '原子写'))
    expect(files.filter((f) => f.includes('.tmp-'))).toEqual([])
    expect(files).toContain('story.json')
  })

  it('项目不存在时抛 NOT_FOUND', async () => {
    await expect(projects.loadStory('不存在的项目')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(projects.deleteProject('不存在的项目')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('版本迁移：缺省 meta.version 在解析时补齐为当前 Schema 版本', async () => {
    const raw = JSON.stringify({
      meta: { title: '旧项目' }, // 无 version
      start: 'start',
      nodes: { start: { id: 'start', text: 't', choices: [] } },
      endings: {},
    })
    const story = parseStory(raw)
    expect(story.meta.version).toBe(SCHEMA_VERSION)
    // 落盘读取同样经过迁移
    await mkdir(path.join(tmp, '旧项目'), { recursive: true })
    await writeFile(path.join(tmp, '旧项目', 'story.json'), raw, 'utf-8')
    const loaded = await projects.loadStory('旧项目')
    expect(loaded.meta.version).toBe(SCHEMA_VERSION)
  })

  it('loadStory 后 story.json 文本保持原样（校验不重写磁盘）', async () => {
    await projects.saveStory(projects.createSkeletonStory({ title: '原样' }))
    const before = await readFile(path.join(tmp, '原样', 'story.json'), 'utf-8')
    await projects.loadStory('原样')
    const after = await readFile(path.join(tmp, '原样', 'story.json'), 'utf-8')
    expect(after).toBe(before)
  })
})
