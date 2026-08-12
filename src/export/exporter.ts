import { build } from 'esbuild'
import { mkdir, writeFile } from 'fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Story, ThemeConfig } from '../core/types.js'
import { renderHtmlTemplate } from './template.js'

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

/* ------------------------------ 内置主题 ------------------------------ */

export const THEMES: Record<string, ThemeConfig> = {
  /** 暗色 · 悬疑 / 怪谈 */
  dark: {
    background:
      'radial-gradient(1100px 560px at 50% -12%, #151b28 0%, transparent 62%), linear-gradient(180deg, #0a0d12 0%, #06080c 100%)',
    card: 'rgba(16, 20, 28, 0.9)',
    border: '#232a37',
    borderGlow: '#4a5a7a',
    text: '#d8dce4',
    textDim: '#8a93a6',
    accent: '#8fb8ff',
    danger: '#c94f4f',
    gold: '#d8b26a',
    green: '#7fb58a',
    purple: '#a88fd8',
  },
  /** 赛博 · 霓虹 */
  cyber: {
    background:
      'radial-gradient(900px 520px at 82% -12%, #1b1030 0%, transparent 62%), linear-gradient(180deg, #0d0a1a 0%, #060410 100%)',
    card: 'rgba(22, 15, 44, 0.92)',
    border: '#3b2d63',
    borderGlow: '#7b5cff',
    text: '#e6e0fa',
    textDim: '#9a8fc0',
    accent: '#00e5ff',
    danger: '#ff3d81',
    gold: '#ffd166',
    green: '#00ffa3',
    purple: '#a78bfa',
  },
  /** 温馨 · 日常 */
  cozy: {
    background:
      'radial-gradient(900px 520px at 50% -12%, #f7e8d0 0%, transparent 65%), linear-gradient(180deg, #fdf6ec 0%, #f3e7d2 100%)',
    card: 'rgba(255, 252, 246, 0.94)',
    border: '#e2d3ba',
    borderGlow: '#c9a86a',
    text: '#3d3428',
    textDim: '#8a7a63',
    accent: '#d97e4a',
    danger: '#c0392b',
    gold: '#b8860b',
    green: '#5f8f4e',
    purple: '#8e6f9e',
  },
  /** 纸页 · 复古 */
  paper: {
    background: 'linear-gradient(180deg, #f4ecd8 0%, #e7dcc0 100%)',
    card: 'rgba(250, 244, 226, 0.95)',
    border: '#cbb894',
    borderGlow: '#a08050',
    text: '#2f2a20',
    textDim: '#7a6f58',
    accent: '#8a5a2b',
    danger: '#a03020',
    gold: '#9c7a1e',
    green: '#55763c',
    purple: '#6f5a7a',
  },
}

/** 浅色主题（color-scheme 需切到 light） */
const LIGHT_THEMES = new Set(['cozy', 'paper'])

/** 解析 meta.theme：内置名或自定义 ThemeConfig；未知名称回退 dark */
export function resolveTheme(theme: string | ThemeConfig | undefined): {
  colors: ThemeConfig
  scheme: 'dark' | 'light'
  name: string
} {
  if (typeof theme === 'string') {
    const colors = THEMES[theme]
    if (colors) {
      return { colors, scheme: LIGHT_THEMES.has(theme) ? 'light' : 'dark', name: theme }
    }
    console.warn(`[ai-text-engine] 未知主题 "${theme}"，回退 dark`)
    return { colors: THEMES.dark, scheme: 'dark', name: 'dark' }
  }
  if (theme && typeof theme === 'object') {
    return { colors: { ...THEMES.dark, ...theme }, scheme: 'dark', name: 'custom' }
  }
  return { colors: THEMES.dark, scheme: 'dark', name: 'dark' }
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
