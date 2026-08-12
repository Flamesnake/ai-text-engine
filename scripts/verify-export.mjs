// 验证导出的单文件 HTML：提取内嵌剧情 → 引擎校验 → 实际游玩一条路线
// 用法：node scripts/verify-export.mjs <html路径>
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validate } from '../dist/core/validate.js'
import { walkAllEndings } from '../dist/core/walk.js'
import { Game } from '../dist/core/engine.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const htmlPath = process.argv[2] ?? path.join(root, 'projects/迷雾车站/dist/index.html')

const html = await readFile(htmlPath, 'utf-8')
const m = html.match(/window\.__STORY__ = (\{[\s\S]*?\})<\/script>/)
if (!m) {
  console.error('未在 HTML 中找到 __STORY__ 嵌入')
  process.exit(1)
}
const story = JSON.parse(m[1])

const problems = validate(story)
console.log('标题:', story.meta.title)
console.log('节点数:', Object.keys(story.nodes).length, '结局数:', Object.keys(story.endings).length)
console.log('validate:', problems.length === 0 ? '通过' : problems.join('; '))

const walk = walkAllEndings(story)
console.log(
  '结局覆盖:',
  walk.endings.map((e) => `${e.endingId}(${e.paths}路/${e.minSteps}步)`).join(' '),
  '| 未到达:', walk.unreachableEndings.length === 0 ? '无' : walk.unreachableEndings.join(','),
)

// 实际游玩一条路线：一直选第一个选项直到结局
const game = new Game(story)
let guard = 0
while (!game.isEnding && guard < 50) {
  const choices = game.visibleChoices()
  if (choices.length === 0) break
  game.choose(0)
  guard++
}
console.log('实际游玩（一直选第一项）:', game.isEnding ? `到达结局「${game.endingMeta?.title}」共${game.stepCount}步` : '未到结局（异常）')

const ok = problems.length === 0 && walk.unreachableEndings.length === 0 && game.isEnding
console.log(ok ? 'VERIFY OK' : 'VERIFY FAIL')
process.exit(ok ? 0 : 1)
