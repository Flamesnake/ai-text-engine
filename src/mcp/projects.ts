import { mkdir, readFile, writeFile, readdir, rm, rename } from 'fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Story } from '../core/types.js'
import { parseStory, SCHEMA_VERSION, StorySchemaError } from '../core/schema.js'
import { safeName } from '../export/exporter.js'

/**
 * 项目存储深模块：一切磁盘细节（目录命名、原子写入、错误区分、并发冲突）集中于此。
 *
 * 约定：
 * - 项目目录 = 清洗标题（safeName），标题碰撞时自动追加 -2/-3 序号（稳定 ID）；
 * - 写入采用「临时文件 + rename」原子替换，避免中断留下半截 JSON；
 * - 错误类型明确：NOT_FOUND / CORRUPT / WRITE_FAILED / CONFLICT / TITLE_INVALID，
 *   不再把 JSON 损坏、权限错误伪装成「项目不存在」；
 * - 冲突检测：同一进程内若项目在「读取后、保存前」被其他编辑修改过，拒绝覆盖。
 */

/** projects 根目录（可被测试覆盖） */
export let PROJECTS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../projects',
)

export type ProjectErrorCode =
  | 'NOT_FOUND'
  | 'CORRUPT'
  | 'WRITE_FAILED'
  | 'CONFLICT'
  | 'TITLE_INVALID'

/** 存储层错误：带稳定 code，供上层区分处理 */
export class ProjectError extends Error {
  readonly code: ProjectErrorCode

  constructor(code: ProjectErrorCode, message: string) {
    super(message)
    this.name = 'ProjectError'
    this.code = code
  }
}

/** 测试注入：替换项目根目录（同时清空冲突检测缓存） */
export function setProjectsRoot(dir: string): void {
  PROJECTS_ROOT = dir
  loadedCache.clear()
}

/* ------------------------------ 目录解析 ------------------------------ */

const dirOf = (name: string): string => path.join(PROJECTS_ROOT, name)

/** 读取某目录内 story.json 的 meta.title；目录不存在/文件缺失返回 null */
async function readTitle(dirName: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(dirOf(dirName), 'story.json'), 'utf-8')
    const meta = (JSON.parse(raw) as { meta?: { title?: unknown } }).meta
    return typeof meta?.title === 'string' ? meta.title : null
  } catch {
    return null
  }
}

interface FoundProject {
  dir: string
  raw: string
}

/**
 * 按标题定位项目目录（含序号后缀候选）。
 * - 目录的 story.json 存在且 meta.title 匹配 → 命中；
 * - 候选目录的 story.json 无法解析（损坏）且是首个候选（base）→ 抛 CORRUPT；
 * - 全部候选都不存在 → 返回 null。
 */
async function findProject(title: string): Promise<FoundProject | null> {
  const base = safeName(title)
  for (let i = 1; i <= 999; i++) {
    const dirName = i === 1 ? base : `${base}-${i}`
    const file = path.join(dirOf(dirName), 'story.json')
    let raw: string
    try {
      raw = await readFile(file, 'utf-8')
    } catch {
      continue // 目录或文件不存在，试下一个候选
    }
    let metaTitle: unknown
    try {
      metaTitle = (JSON.parse(raw) as { meta?: { title?: unknown } }).meta?.title
    } catch {
      if (i === 1) {
        throw new ProjectError(
          'CORRUPT',
          `项目 "${title}" 的 story.json 不是合法 JSON（${file}），请修复或删除该目录`,
        )
      }
      continue
    }
    if (metaTitle === title) return { dir: dirOf(dirName), raw }
    // 目录被其他标题占用，继续找序号后缀
  }
  return null
}

/** 解析项目目录（不存在抛 NOT_FOUND） */
export async function resolveProjectDir(title: string): Promise<string> {
  const found = await findProject(title)
  if (!found) throw new ProjectError('NOT_FOUND', `项目 "${title}" 不存在`)
  return found.dir
}

/** 新项目落盘目录：base 未被占用用 base，否则自动追加序号 */
async function freshDirFor(title: string): Promise<string> {
  const base = safeName(title)
  for (let i = 1; i <= 999; i++) {
    const dirName = i === 1 ? base : `${base}-${i}`
    if ((await readTitle(dirName)) === null) return dirOf(dirName)
  }
  throw new ProjectError('WRITE_FAILED', `项目目录 ${base}-* 序号已耗尽，无法创建项目 "${title}"`)
}

/* ------------------------------ 读写 ------------------------------ */

/** 新项目骨架：start 节点 + 一个示例结局 */
export function createSkeletonStory(meta: {
  title: string
  subtitle?: string
  author?: string
}): Story {
  return {
    meta: {
      title: meta.title,
      subtitle: meta.subtitle,
      author: meta.author,
      version: SCHEMA_VERSION,
    },
    start: 'start',
    endings: {
      e_end: { id: 'e_end', title: '结局', kind: 'good' },
    },
    nodes: {
      start: {
        id: 'start',
        text: '（这是起始节点。用 story_upsert_node 添加节点与选项，用 story_validate 检查完整性，最后 story_export 导出 HTML。）',
        choices: [{ label: '看看这个示例结局', target: 'end' }],
      },
      end: {
        id: 'end',
        text: '这是结局节点。删掉它，换成你自己的故事吧。',
        choices: [],
        ending: { id: 'e_end', title: '结局', kind: 'good' },
      },
    },
  }
}

/** 最近一次读取/保存的原始内容（key = 根目录 + 标题），用于并发冲突检测 */
const loadedCache = new Map<string, string>()

const cacheKey = (title: string): string => `${PROJECTS_ROOT}\u0000${title}`

/** 读取项目剧情；不存在抛 NOT_FOUND，数据损坏抛 CORRUPT */
export async function loadStory(title: string): Promise<Story> {
  const found = await findProject(title)
  if (!found) throw new ProjectError('NOT_FOUND', `项目 "${title}" 不存在`)
  try {
    const story = parseStory(found.raw)
    loadedCache.set(cacheKey(title), found.raw)
    return story
  } catch (err) {
    if (err instanceof StorySchemaError) {
      throw new ProjectError('CORRUPT', `项目 "${title}" 的 story.json 数据无效：${err.message}`)
    }
    throw err
  }
}

/**
 * 保存剧情（原子写 + 冲突检测）。返回实际写入的目录。
 * 若本进程读取过该项目，且磁盘内容已与读取时不一致，抛 CONFLICT 拒绝覆盖。
 */
export async function saveStory(story: Story): Promise<string> {
  // 所有调用方共享的最后一道落盘防线：先完整解析，再写入规整后的数据。
  // 读取仍使用宽容 schema 兼容旧项目；MCP 各写入边界负责 strict 拒绝未知字段。
  const validatedStory = parseStory(structuredClone(story))
  const title = validatedStory.meta.title
  if (!title?.trim()) throw new ProjectError('TITLE_INVALID', 'meta.title 不能为空')
  const key = cacheKey(title)
  const expected = loadedCache.get(key)

  const existing = await findProject(title)

  // 冲突检测：本进程读取过本标题，且磁盘当前内容 ≠ 读取时内容 → 拒绝覆盖（避免丢失更新）
  if (expected !== undefined) {
    const file = path.join(existing ? existing.dir : dirOf(safeName(title)), 'story.json')
    let current: string | null = null
    try {
      current = await readFile(file, 'utf-8')
    } catch {
      // 文件被外部删除/移动：同样视为内容已变化
    }
    if (current !== expected) {
      throw new ProjectError(
        'CONFLICT',
        `项目 "${title}" 在读取后被其他编辑修改，已拒绝覆盖（避免丢失更新）。请重新 story_get 后再写入`,
      )
    }
  }

  // 目录定位：已有项目用原目录；新项目在 base 被占用（碰撞/损坏）时自动加序号
  const dir = existing ? existing.dir : await freshDirFor(title)
  await mkdir(dir, { recursive: true })
  const data = JSON.stringify(validatedStory, null, 2)
  await atomicWrite(path.join(dir, 'story.json'), data)
  loadedCache.set(key, data)
  return dir
}

/** 临时文件 + rename 原子替换；Windows 上 rename 覆盖失败时退化为删除后重命名 */
async function atomicWrite(file: string, data: string): Promise<void> {
  const tmp = path.join(path.dirname(file), `.story.json.tmp-${process.pid}-${Date.now()}`)
  try {
    await writeFile(tmp, data, 'utf-8')
    await rename(tmp, file)
  } catch (err) {
    try {
      await rm(file, { force: true })
      await rename(tmp, file)
    } catch (err2) {
      await rm(tmp, { force: true }).catch(() => {})
      throw new ProjectError(
        'WRITE_FAILED',
        `写入 ${file} 失败：${err2 instanceof Error ? err2.message : String(err2)}`,
      )
    }
  }
}

/* ------------------------------ 枚举 / 删除 ------------------------------ */

export interface ProjectRef {
  /** 目录名 */
  dir: string
  /** story.meta.title（读不到时回退为目录名） */
  title: string
}

/** 列出所有项目（按目录名排序） */
export async function listProjects(): Promise<ProjectRef[]> {
  try {
    const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true })
    const refs: ProjectRef[] = []
    for (const e of entries.filter((x) => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const title = (await readTitle(e.name)) ?? e.name
      refs.push({ dir: e.name, title })
    }
    return refs
  } catch {
    return []
  }
}

/** 删除整个项目（不存在抛 NOT_FOUND） */
export async function deleteProject(title: string): Promise<void> {
  const found = await findProject(title)
  if (!found) throw new ProjectError('NOT_FOUND', `项目 "${title}" 不存在`)
  await rm(found.dir, { recursive: true, force: true })
  loadedCache.delete(cacheKey(title))
}
