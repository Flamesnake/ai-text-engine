import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  doctor,
  exportProject,
  initHome,
  installSkill,
  projectsRootForHome,
  resolveSkillTarget,
  validateProject,
} from './commands.js'
import * as projects from '../mcp/projects.js'

describe('npm CLI commands', () => {
  it('显式 home 始终把作品放在 projects 子目录', () => {
    expect(projectsRootForHome('relative-home')).toBe(path.resolve('relative-home', 'projects'))
  })

  it('init 创建作品目录', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ate-cli-home-'))
    const result = await initHome(root)
    await expect(access(result.projectsRoot)).resolves.toBeUndefined()
  })

  it('按客户端解析 Skill 目录，也支持自定义目标', () => {
    const homeDir = path.join(path.sep, 'home', 'tester')
    expect(resolveSkillTarget('agents', { homeDir })).toContain(path.join('.agents', 'skills', 'talespindle-author'))
    expect(resolveSkillTarget('codex', { homeDir })).toContain(path.join('.agents', 'skills', 'talespindle-author'))
    expect(resolveSkillTarget('agents', { homeDir })).toContain(path.join('.agents', 'skills', 'talespindle-author'))
    expect(resolveSkillTarget('claude', { homeDir })).toContain(path.join('.claude', 'skills', 'talespindle-author'))
    expect(resolveSkillTarget('agents', { target: 'custom-skills', homeDir })).toBe(path.resolve('custom-skills', 'talespindle-author'))
  })

  it('安装 Skill，默认拒绝静默覆盖并允许显式 force', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ate-cli-skill-'))
    const first = await installSkill({ target: root })
    expect(await readFile(path.join(first.destination, 'SKILL.md'), 'utf8')).toContain('TaleSpindle')
    await expect(installSkill({ target: root })).rejects.toThrow(/--force/)
    await writeFile(path.join(first.destination, 'stale.txt'), 'stale', 'utf8')
    await installSkill({ target: root, force: true })
    await expect(access(path.join(first.destination, 'stale.txt'))).rejects.toThrow()
  })

  it('doctor 返回结构化健康检查', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ate-cli-doctor-'))
    const result = await doctor({ home: root })
    expect(result.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(result.projectsRoot).toBe(path.join(root, 'projects'))
    expect(result.checks.map((check) => check.name)).toEqual([
      'package', 'mcp-server', 'runtime-bundle', 'skill', 'projects-root',
    ])
  })

  it('export 命令导出 HTML（薄封装 story_export，与 MCP 同一 handler）', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ate-cli-export-'))
    projects.setProjectsRoot(root)
    await projects.saveStory(projects.createSkeletonStory({ title: 'CLI导出' }))
    const result = (await exportProject({ title: 'CLI导出' })) as {
      ok: boolean
      outputPath: string
      sizeBytes: number
      endingCount: number
    }
    expect(result.ok).toBe(true)
    expect(result.endingCount).toBeGreaterThan(0)
    const html = await readFile(result.outputPath, 'utf-8')
    expect(html).toContain('TextAdventure.mountTextAdventure')
    expect(result.sizeBytes).toBeGreaterThan(1000)
  })

  it('validate 命令返回校验结论（薄封装 story_validate）', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ate-cli-validate-'))
    projects.setProjectsRoot(root)
    await projects.saveStory(projects.createSkeletonStory({ title: 'CLI校验' }))
    const ok = (await validateProject({ title: 'CLI校验' })) as { validatePass: boolean; nodeCount: number }
    expect(ok.validatePass).toBe(true)
    expect(ok.nodeCount).toBe(2)

    // 破坏剧情 → 校验失败
    const story = await projects.loadStory('CLI校验')
    story.nodes.start.choices[0].target = '不存在的节点'
    await projects.saveStory(story)
    const broken = (await validateProject({ title: 'CLI校验' })) as { validatePass: boolean; problems: unknown[] }
    expect(broken.validatePass).toBe(false)
    expect(broken.problems.length).toBeGreaterThan(0)
  })
})
