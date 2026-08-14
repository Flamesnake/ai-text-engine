import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStory } from '../dist/core/schema.js'
import { validate } from '../dist/core/validate.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const projectsDir = path.join(root, 'projects')
const entries = await readdir(projectsDir, { withFileTypes: true })
const stories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
let checked = 0
const failures = []

for (const title of stories) {
  const storyPath = path.join(projectsDir, title, 'story.json')
  let source
  try {
    source = await readFile(storyPath, 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') continue
    failures.push(`${title}: 无法读取 story.json (${error instanceof Error ? error.message : String(error)})`)
    continue
  }

  try {
    const story = parseStory(source.replace(/^\uFEFF/u, ''))
    const problems = validate(story)
    if (problems.length > 0) {
      failures.push(`${title}: ${problems.length} 个静态问题\n  - ${problems.slice(0, 5).join('\n  - ')}`)
    }
    checked += 1
  } catch (error) {
    failures.push(`${title}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (checked === 0) failures.push('没有找到可校验的 projects/*/story.json')
if (failures.length > 0) {
  console.error(`PROJECT VERIFY FAILED (${checked} checked)\n${failures.join('\n')}`)
  process.exitCode = 1
} else {
  console.log(`PROJECT VERIFY OK (${checked} stories)`)
}
