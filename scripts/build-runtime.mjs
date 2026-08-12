// 构建脚本：把运行时渲染器 bundle 成单文件 IIFE（供 npm run build 使用）
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outFile = path.join(root, 'dist/export/runtime.bundle.js')

await build({
  entryPoints: [path.join(root, 'src/export/runtime.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'TextAdventure',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  outfile: outFile,
  logLevel: 'info',
})

console.log('runtime bundle written:', outFile)
