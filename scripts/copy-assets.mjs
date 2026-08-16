// 构建期资源复制：把模板独立样式表等非 TS 资源拷进 dist（P2-5）。
// tsc 不复制 .css；运行时（npm 包 / dist 直跑）从 dist/export/template.css 读取。
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const assets = [
  ['src/export/template.css', 'dist/export/template.css'],
]

for (const [source, target] of assets) {
  await mkdir(path.dirname(path.join(root, target)), { recursive: true })
  await copyFile(path.join(root, source), path.join(root, target))
  console.log(`asset copied: ${source} -> ${target}`)
}