import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { doctor, initHome, installSkill, projectsRootForHome, resolveSkillTarget } from './commands.js'

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
    expect(resolveSkillTarget('agents', { homeDir })).toContain(path.join('.agents', 'skills', 'ai-text-engine'))
    expect(resolveSkillTarget('codex', { homeDir })).toContain(path.join('.codex', 'skills', 'ai-text-engine'))
    expect(resolveSkillTarget('claude', { homeDir })).toContain(path.join('.claude', 'skills', 'ai-text-engine'))
    expect(resolveSkillTarget('agents', { target: 'custom-skills', homeDir })).toBe(path.resolve('custom-skills', 'ai-text-engine'))
  })

  it('安装 Skill，默认拒绝静默覆盖并允许显式 force', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ate-cli-skill-'))
    const first = await installSkill({ target: root })
    expect(await readFile(path.join(first.destination, 'SKILL.md'), 'utf8')).toContain('ai-text-engine')
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
})
