// 构建脚本：把运行时渲染器 bundle 成单文件 IIFE（供 npm run build 使用）
// 产出两条产物（P1-7）：
//   runtime.bundle.js      全量（含 three.js 3D 舞台）
//   runtime-lite.bundle.js 精简（stage3d 换成空桩，无舞台作品使用，省 ~600KB）
// 头部注入构建时间戳与源码最新 mtime，供导出器做「新鲜度护栏」（P1-2）：
// 修改 src/export/* 后忘记重新 build 时，story_export 会提示过期，避免静默用旧 runtime。
import { build } from 'esbuild'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distExport = path.join(root, 'dist/export')
const srcExportDir = path.join(root, 'src/export')
const stubPath = path.join(srcExportDir, 'stage3d-lite.ts')

// 参与 bundle 的源码最新 mtime（排除测试文件）
const sources = readdirSync(srcExportDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
const srcMtime = Math.max(...sources.map((f) => statSync(path.join(srcExportDir, f)).mtimeMs))
const builtAt = Date.now()

/** lite 构建：把 ./stage3d.js 解析到空桩，three 树被整体裁剪。 */
const litePlugin = {
  name: 'stage3d-lite-stub',
  setup(ctx) {
    ctx.onResolve({ filter: /stage3d\.js$/ }, () => ({ path: stubPath }))
  },
}

const configs = [
  {
    name: 'full',
    outFile: path.join(distExport, 'runtime.bundle.js'),
    plugins: undefined,
  },
  {
    name: 'lite',
    outFile: path.join(distExport, 'runtime-lite.bundle.js'),
    plugins: [litePlugin],
  },
]

let totalBytes = 0
for (const config of configs) {
  const banner = `/* talespindle-runtime: built=${builtAt} srcMtime=${Math.round(srcMtime)} variant=${config.name} */\n`
  const result = await build({
    entryPoints: [path.join(root, 'src/export/runtime.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'TextAdventure',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    banner: { js: banner },
    plugins: config.plugins,
    outfile: config.outFile,
    logLevel: 'info',
  })
  const bytes = statSync(config.outFile).size
  totalBytes += bytes
  console.log(`runtime bundle written: ${config.outFile} (${(bytes / 1024).toFixed(1)}KB, variant=${config.name})`)
}

console.log(`runtime bundles total: ${(totalBytes / 1024).toFixed(1)}KB (srcMtime=${Math.round(srcMtime)})`)