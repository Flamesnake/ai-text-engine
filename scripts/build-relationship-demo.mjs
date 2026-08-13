import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStory } from '../dist/core/schema.js'
import { validate } from '../dist/core/validate.js'
import { exportToHtml } from '../dist/export/exporter.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const raw = await readFile(path.join(root, 'examples', 'relationship-demo.story.json'), 'utf-8')
const story = parseStory(raw)
const problems = validate(story)
if (problems.length > 0) throw new Error(`样例校验失败：\n${problems.join('\n')}`)
const result = await exportToHtml(story, {
  outputDir: path.join(root, 'projects', 'relationship-demo', 'dist'),
})
console.log(result.outputPath)
