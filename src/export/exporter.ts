import { mkdir, readFile, writeFile, readdir, stat } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Story } from '../core/types.js'
import { renderHtmlTemplate } from './template.js'
import { resolveTheme } from './themes.js'
export { THEMES, resolveTheme } from './themes.js'

/**
 * 单文件 HTML 导出器（Node 端）。
 *
 * 流程：
 * 1. 用 esbuild 把 src/export/runtime.ts（含引擎核心）bundle 成 IIFE；
 *    生产路径直接读预构建 dist/export/runtime.bundle.js（见 scripts/build-runtime.mjs），
 *    并校验其新鲜度（P1-2）：src/export 里有比 bundle 更新的源码时给出过期警告；
 * 2. 解析主题（meta.theme：内置主题名或自定义 ThemeConfig）；
 * 3. 拼装自包含 HTML（模板与内联 CSS 见 template.ts）：注入主题变量 + 剧情 JSON + runtime JS；
 * 4. 写入 <outputDir>/index.html —— 双击即玩，零外部依赖。
 */

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RUNTIME_ENTRY = path.join(PKG_ROOT, 'src/export/runtime.ts')
const PREBUILT_RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runtime.bundle.js')
const DEV_PREBUILT_RUNTIME = path.join(PKG_ROOT, 'dist/export/runtime.bundle.js')
const PREBUILT_RUNTIME_LITE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runtime-lite.bundle.js')
const DEV_PREBUILT_RUNTIME_LITE = path.join(PKG_ROOT, 'dist/export/runtime-lite.bundle.js')
const STAGE3D_STUB = path.join(PKG_ROOT, 'src/export/stage3d-lite.ts')

/** 作品是否使用 3D 舞台：任一节点含非 clear 的 stage cue 即需要 full bundle（P1-7）。 */
export function storyNeedsStage(story: Story): boolean {
  return Object.values(story.nodes).some((node) => node.stage !== undefined && node.stage !== 'clear')
}

export interface ExportOptions {
  /** 输出目录（默认 projects/<标题>/dist） */
  outputDir?: string
  minify?: boolean
}

export interface ExportResult {
  outputPath: string
  sizeBytes: number
  nodeCount: number
  endingCount: number
  /** 预构建 runtime 过期提示（build-runtime 之后改过 src/export 且未重新 build 时出现） */
  runtimeWarning?: string
}

/** 导出单文件 HTML 游戏 */
export async function exportToHtml(story: Story, options?: ExportOptions): Promise<ExportResult> {
  const minify = options?.minify ?? true
  const outDir =
    options?.outputDir ?? path.join(PKG_ROOT, 'projects', safeName(story.meta.title), 'dist')

  const { runtimeJs, runtimeWarning } = await bundleRuntime(minify, storyNeedsStage(story))
  const theme = resolveTheme(story.meta.theme)
  const html = renderHtmlTemplate(story, runtimeJs, theme)

  await mkdir(outDir, { recursive: true })
  const outputPath = path.join(outDir, 'index.html')
  await writeFile(outputPath, html, 'utf-8')

  return {
    outputPath,
    sizeBytes: Buffer.byteLength(html, 'utf-8'),
    nodeCount: Object.keys(story.nodes).length,
    endingCount: Object.keys(story.endings).length,
    ...(runtimeWarning ? { runtimeWarning } : {}),
  }
}

/** 预构建 bundle 头部的新鲜度信息（由 scripts/build-runtime.mjs 注入） */
export const RUNTIME_BANNER_RE = /talespindle-runtime:\s*built=(\d+)\s+srcMtime=(\d+)/

/** 解析预构建 banner；无 banner 的旧产物返回 null。 */
export function parseRuntimeBanner(bundle: string): { built: number; srcMtime: number } | null {
  const match = RUNTIME_BANNER_RE.exec(bundle.slice(0, 500))
  if (!match) return null
  return { built: Number(match[1]), srcMtime: Number(match[2]) }
}

/** src/export 下非测试 .ts 源文件的最新 mtime（与 build-runtime.mjs 同口径） */
export async function latestSourceMtime(): Promise<number> {
  const srcExportDir = path.join(PKG_ROOT, 'src/export')
  if (!existsSync(srcExportDir)) return 0
  let max = 0
  for (const entry of await readdir(srcExportDir)) {
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      const mtime = (await stat(path.join(srcExportDir, entry))).mtimeMs
      if (mtime > max) max = mtime
    }
  }
  return max
}

/** 新鲜度护栏：bundle 构建后改过 src/export 源码 → 返回过期提示；无法判断或 npm 包场景返回 undefined。 */
export async function checkRuntimeFreshness(bundle: string): Promise<string | undefined> {
  const info = parseRuntimeBanner(bundle)
  if (!info) return undefined // 旧产物无 banner：无从比较，不打扰
  const current = await latestSourceMtime()
  if (current <= info.srcMtime) return undefined
  return (
    'runtime bundle 已过期：src/export 有晚于预构建的新改动（bundle 构建于 ' +
    `${new Date(info.built).toISOString()}），stale runtime 会被用于导出，请重新运行 npm run build`
  )
}

/**
 * 用 esbuild 把运行时渲染器（含引擎核心）打包为浏览器 IIFE。
 * needsStage 决定产物：无舞台作品用 lite bundle（stage3d 换空桩，不背 three.js，P1-7）。
 */
async function bundleRuntime(minify: boolean, needsStage: boolean): Promise<{ runtimeJs: string; runtimeWarning?: string }> {
  if (minify) {
    const candidates = needsStage
      ? [PREBUILT_RUNTIME, DEV_PREBUILT_RUNTIME]
      : [PREBUILT_RUNTIME_LITE, DEV_PREBUILT_RUNTIME_LITE]
    for (const candidate of candidates) {
      try {
        const runtimeJs = await readFile(candidate, 'utf8')
        // 只在开发仓库（src 存在）里做新鲜度检查；npm 包无 src，跳过。
        const runtimeWarning = existsSync(path.join(PKG_ROOT, 'src'))
          ? await checkRuntimeFreshness(runtimeJs)
          : undefined
        if (runtimeWarning) console.warn(`[talespindle] ${runtimeWarning}`)
        return { runtimeJs, runtimeWarning }
      } catch {
        // 源码测试在首次 build 前没有预构建文件，继续使用开发期回退。
      }
    }
  }

  const { build } = await import('esbuild')
  // lite 回退构建：把 ./stage3d.js 解析到空桩，与 build-runtime.mjs 的 lite 产物同构。
  const litePlugin = {
    name: 'stage3d-lite-stub',
    setup(ctx: { onResolve: (options: { filter: RegExp }, cb: () => { path: string }) => void }) {
      ctx.onResolve({ filter: /stage3d\.js$/ }, () => ({ path: STAGE3D_STUB }))
    },
  }
  const result = await build({
    entryPoints: [RUNTIME_ENTRY],
    bundle: true,
    format: 'iife',
    globalName: 'TextAdventure',
    platform: 'browser',
    target: ['es2020'],
    minify,
    write: false,
    logLevel: 'silent',
    plugins: needsStage ? undefined : [litePlugin],
  })
  return { runtimeJs: result.outputFiles[0].text }
}

/** 标题 → 安全目录名 */
export function safeName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'untitled-game'
}
