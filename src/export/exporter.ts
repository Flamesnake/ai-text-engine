import { mkdir, readFile, writeFile } from 'fs/promises'
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
 * 2. 解析主题（meta.theme：内置主题名或自定义 ThemeConfig）；
 * 3. 拼装自包含 HTML（模板与内联 CSS 见 template.ts）：注入主题变量 + 剧情 JSON + runtime JS；
 * 4. 写入 <outputDir>/index.html —— 双击即玩，零外部依赖。
 */

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RUNTIME_ENTRY = path.join(PKG_ROOT, 'src/export/runtime.ts')
const PREBUILT_RUNTIME = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runtime.bundle.js')
const DEV_PREBUILT_RUNTIME = path.join(PKG_ROOT, 'dist/export/runtime.bundle.js')

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
}

/** 导出单文件 HTML 游戏 */
export async function exportToHtml(story: Story, options?: ExportOptions): Promise<ExportResult> {
  const minify = options?.minify ?? true
  const outDir =
    options?.outputDir ?? path.join(PKG_ROOT, 'projects', safeName(story.meta.title), 'dist')

  const runtimeJs = await bundleRuntime(minify)
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
  }
}

/** 用 esbuild 把运行时渲染器（含引擎核心）打包为浏览器 IIFE */
async function bundleRuntime(minify: boolean): Promise<string> {
  if (minify) {
    for (const candidate of [PREBUILT_RUNTIME, DEV_PREBUILT_RUNTIME]) {
      try {
        return await readFile(candidate, 'utf8')
      } catch {
        // 源码测试在首次 build 前没有预构建文件，继续使用开发期回退。
      }
    }
  }

  const { build } = await import('esbuild')
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
  })
  return result.outputFiles[0].text
}

/** 标题 → 安全目录名 */
export function safeName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'untitled-game'
}
