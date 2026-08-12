import { mkdir, readFile, writeFile, readdir, rm } from 'fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Story } from '../core/types.js'
import { safeName } from '../export/exporter.js'

/** projects 根目录（可被测试覆盖） */
export let PROJECTS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../projects',
)

/** 测试注入：替换项目根目录 */
export function setProjectsRoot(dir: string): void {
  PROJECTS_ROOT = dir
}

export function projectDir(title: string): string {
  return path.join(PROJECTS_ROOT, safeName(title))
}

export function storyPath(title: string): string {
  return path.join(projectDir(title), 'story.json')
}

/** 读取项目剧情；不存在时抛错 */
export async function loadStory(title: string): Promise<Story> {
  try {
    const raw = await readFile(storyPath(title), 'utf-8')
    return JSON.parse(raw) as Story
  } catch {
    throw new Error(`项目 "${title}" 不存在（projects/${safeName(title)}/story.json 缺失）`)
  }
}

/** 保存剧情（按 meta.title 决定目录） */
export async function saveStory(story: Story): Promise<void> {
  const dir = projectDir(story.meta.title)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'story.json'), JSON.stringify(story, null, 2), 'utf-8')
}

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
      version: '0.1.0',
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

/** 列出所有项目名（目录名） */
export async function listProjects(): Promise<string[]> {
  try {
    const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
  } catch {
    return []
  }
}

/** 删除整个项目 */
export async function deleteProject(title: string): Promise<void> {
  await rm(projectDir(title), { recursive: true, force: true })
}
