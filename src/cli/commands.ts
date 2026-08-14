import { access, cp, mkdir, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDefaultProjectsRoot } from '../mcp/projects.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const BUNDLED_SKILL = path.join(PACKAGE_ROOT, 'skill')

export type SkillClient = 'agents' | 'codex' | 'claude'

export interface DoctorResult {
  ok: boolean
  version: string
  node: string
  packageRoot: string
  projectsRoot: string
  checks: Array<{ name: string; ok: boolean; path?: string; message?: string }>
}

export function projectsRootForHome(home?: string): string {
  return home?.trim()
    ? path.join(path.resolve(home), 'projects')
    : resolveDefaultProjectsRoot()
}

export async function doctor(options: { home?: string } = {}): Promise<DoctorResult> {
  const packageJsonPath = path.join(PACKAGE_ROOT, 'package.json')
  const serverPath = path.join(PACKAGE_ROOT, 'dist', 'mcp', 'server.js')
  const runtimePath = path.join(PACKAGE_ROOT, 'dist', 'export', 'runtime.bundle.js')
  const skillPath = path.join(BUNDLED_SKILL, 'SKILL.md')
  const projectsRoot = projectsRootForHome(options.home)
  const checks: DoctorResult['checks'] = []

  let version = 'unknown'
  try {
    const pkg = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version?: unknown }
    if (typeof pkg.version === 'string') version = pkg.version
    checks.push({ name: 'package', ok: true, path: packageJsonPath })
  } catch (error) {
    checks.push({ name: 'package', ok: false, path: packageJsonPath, message: errorMessage(error) })
  }

  for (const [name, target] of [['mcp-server', serverPath], ['runtime-bundle', runtimePath], ['skill', skillPath]] as const) {
    try {
      await access(target, constants.R_OK)
      checks.push({ name, ok: true, path: target })
    } catch (error) {
      checks.push({ name, ok: false, path: target, message: errorMessage(error) })
    }
  }

  try {
    await mkdir(projectsRoot, { recursive: true })
    await access(projectsRoot, constants.R_OK | constants.W_OK)
    checks.push({ name: 'projects-root', ok: true, path: projectsRoot })
  } catch (error) {
    checks.push({ name: 'projects-root', ok: false, path: projectsRoot, message: errorMessage(error) })
  }

  return {
    ok: checks.every((check) => check.ok),
    version,
    node: process.version,
    packageRoot: PACKAGE_ROOT,
    projectsRoot,
    checks,
  }
}

export async function initHome(home?: string): Promise<{ projectsRoot: string }> {
  const projectsRoot = projectsRootForHome(home)
  await mkdir(projectsRoot, { recursive: true })
  return { projectsRoot }
}

export function resolveSkillTarget(
  client: SkillClient,
  options: { target?: string; homeDir?: string } = {},
): string {
  if (options.target?.trim()) return path.join(path.resolve(options.target), 'ai-text-engine')
  const homeDir = options.homeDir ?? os.homedir()
  const skillsRoot = client === 'codex'
    ? path.join(homeDir, '.codex', 'skills')
    : client === 'claude'
      ? path.join(homeDir, '.claude', 'skills')
      : path.join(homeDir, '.agents', 'skills')
  return path.join(skillsRoot, 'ai-text-engine')
}

export async function installSkill(options: {
  client?: SkillClient
  target?: string
  force?: boolean
  homeDir?: string
} = {}): Promise<{ client: SkillClient; destination: string }> {
  const client = options.client ?? 'agents'
  const destination = resolveSkillTarget(client, options)
  try {
    await access(destination)
    if (!options.force) {
      throw new Error(`Skill 已存在：${destination}；确认覆盖时增加 --force`)
    }
    await rm(destination, { recursive: true, force: true })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Skill 已存在')) throw error
  }
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(BUNDLED_SKILL, destination, { recursive: true, errorOnExist: true })
  return { client, destination }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
