import { build } from 'esbuild'
import { mkdir, writeFile } from 'fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Story, ThemeConfig } from '../core/types.js'

/**
 * 单文件 HTML 导出器（Node 端）。
 *
 * 流程：
 * 1. 用 esbuild 把 src/export/runtime.ts（含引擎核心）bundle 成 IIFE；
 * 2. 解析主题（meta.theme：内置主题名或自定义 ThemeConfig）；
 * 3. 拼装自包含 HTML：内联 CSS（注入主题变量）+ 剧情 JSON + runtime JS；
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

/** 主题 → :root CSS 变量 */
function cssVars(theme: { colors: ThemeConfig; scheme: 'dark' | 'light' }): string {
  const c = theme.colors
  return `:root {
  --scheme: ${theme.scheme};
  --bg: ${c.background};
  --card: ${c.card};
  --border: ${c.border};
  --border-glow: ${c.borderGlow};
  --text: ${c.text};
  --text-dim: ${c.textDim};
  --accent: ${c.accent};
  --danger: ${c.danger};
  --gold: ${c.gold};
  --green: ${c.green};
  --purple: ${c.purple};
}`
}

/** 组装自包含 HTML */
function renderHtmlTemplate(
  story: Story,
  runtimeJs: string,
  theme: { colors: ThemeConfig; scheme: 'dark' | 'light' },
): string {
  const title = story.meta.title
  const storyJson = JSON.stringify(story)
    // 防止剧情文本包含 </script> 破坏页面
    .replace(/<\/script/gi, '<\\/script')

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
${cssVars(theme)}
${CSS}
</style>
</head>
<body>
<div id="app"></div>
<script>window.__STORY__ = ${storyJson}</script>
<script>${runtimeJs}</script>
<script>
TextAdventure.mountTextAdventure(document.getElementById('app'), window.__STORY__);
</script>
</body>
</html>
`
}

/** 标题 → 安全目录名 */
export function safeName(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'untitled-game'
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* eslint-disable max-len */
const CSS = `
* { box-sizing: border-box; }
html { color-scheme: var(--scheme); }
body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  background-attachment: fixed;
  color: var(--text);
  font-family: 'Noto Serif SC', 'Songti SC', 'STSong', 'SimSun', serif;
  -webkit-font-smoothing: antialiased;
}
#app { min-height: 100vh; }
.btn {
  appearance: none;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  padding: 0.8rem 1.5rem;
  font-family: inherit;
  font-size: 1rem;
  letter-spacing: 0.12em;
  border-radius: 2px;
  cursor: pointer;
  transition: border-color .18s ease, background-color .18s ease, box-shadow .18s ease;
}
.btn:hover:not(:disabled) {
  border-color: var(--border-glow);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 18%, transparent);
}
.btn:disabled { opacity: .45; cursor: default; }
.btn-primary { border-color: var(--accent); color: var(--accent); }
.btn-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  box-shadow: 0 0 24px color-mix(in srgb, var(--accent) 24%, transparent);
}
.btn-ghost { color: var(--text-dim); }

.title-screen {
  min-height: 100vh;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: .9rem; text-align: center;
  padding: 2rem 1rem;
}
.title-badge {
  font-family: 'JetBrains Mono', 'Cascadia Mono', Consolas, monospace;
  font-size: .72rem; letter-spacing: .42em;
  color: var(--text-dim); text-transform: uppercase;
}
.title-main {
  font-size: clamp(2.2rem, 8vw, 3.8rem);
  letter-spacing: .18em; margin: .4rem 0; font-weight: 600;
  text-shadow: 0 0 34px color-mix(in srgb, var(--accent) 40%, transparent);
}
.title-sub { color: var(--text-dim); line-height: 1.9; margin: 0; }
.title-actions {
  display: flex; flex-direction: column; gap: .8rem;
  margin-top: 1.5rem; width: min(300px, 82vw);
}
.title-foot {
  margin-top: 2.2rem; font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: .65rem; letter-spacing: .3em; color: var(--text-dim);
  opacity: .6;
}

.game-screen {
  min-height: 100vh; display: flex; flex-direction: column;
  max-width: 720px; margin: 0 auto; padding: 1.1rem;
}
.game-header {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: .5rem .2rem .2rem;
  color: var(--text-dim);
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: .78rem; letter-spacing: .22em;
}

/* HUD 统计条（好感度等） */
.hud {
  display: flex; flex-wrap: wrap; gap: .8rem 1.4rem;
  margin-top: .9rem;
  padding: .7rem .9rem;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: color-mix(in srgb, var(--card) 60%, transparent);
}
.hud-stat { display: flex; flex-direction: column; gap: .25rem; min-width: 120px; }
.hud-label {
  font-size: .72rem; letter-spacing: .18em;
  color: var(--text-dim);
  font-family: 'JetBrains Mono', Consolas, monospace;
}
.hud-bar {
  height: 6px; width: 120px;
  background: color-mix(in srgb, var(--text-dim) 22%, transparent);
  border-radius: 3px; overflow: hidden;
}
.hud-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width .3s ease;
}
.hud-value { font-size: .78rem; color: var(--text-dim); }

.inventory {
  display: flex; flex-wrap: wrap; gap: .45rem;
  margin-top: .9rem;
}
.inv-chip {
  font-size: .8rem; letter-spacing: .08em;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: .25rem .85rem;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2rem 1.9rem 2.2rem;
  margin-top: 1.2rem;
  box-shadow: 0 18px 52px rgba(0,0,0,.5);
}
.card-text { line-height: 2.05; font-size: 1.06rem; white-space: pre-wrap; min-height: 5em; }
.card-actions { display: flex; flex-direction: column; gap: .7rem; margin-top: 1.7rem; }
.choice-btn { text-align: left; letter-spacing: .05em; }

.card-ending { border-color: var(--border-glow); }
.ending-badge {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: .78rem; letter-spacing: .34em;
  margin-bottom: .6rem; text-transform: uppercase;
}
.ending-good .ending-badge { color: var(--green); }
.ending-bad .ending-badge { color: var(--danger); }
.ending-true .ending-badge { color: var(--gold); }
.ending-hidden .ending-badge { color: var(--purple); }
.ending-title { font-size: 1.5rem; letter-spacing: .12em; margin: .2rem 0 1rem; font-weight: 600; }
.ending-actions { display: flex; gap: .8rem; }
.ending-actions .btn { flex: 1; text-align: center; }

/* 文本块 */
.block-title {
  font-size: 1.2rem; letter-spacing: .14em;
  margin: .2rem 0 1rem; font-weight: 600;
  color: var(--accent);
}
.block-para { line-height: 2.05; font-size: 1.06rem; white-space: pre-wrap; margin: 0 0 .6rem; }
.block {
  border: 1px solid var(--border);
  border-radius: 4px;
  margin: .7rem 0;
  overflow: hidden;
}
.block-head {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: .78rem; letter-spacing: .28em;
  padding: .55rem 1rem;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border-bottom: 1px solid var(--border);
}
.block-body {
  padding: .9rem 1.1rem;
  line-height: 2;
  white-space: pre-wrap;
  font-size: 1rem;
}
.block-rules .block-body { color: var(--gold); font-family: 'JetBrains Mono', Consolas, monospace; font-size: .92rem; }
.block-note .block-body { color: var(--text-dim); font-style: italic; }
.block-letter .block-body { color: var(--text); }

/* 线索夹 */
.docs-btn {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: .72rem; padding: .35rem .8rem; letter-spacing: .12em;
}
.doc-list {
  display: flex; flex-direction: column; gap: .6rem;
  margin-top: 1.2rem;
}
.doc-item {
  display: flex; align-items: center; gap: .8rem;
  appearance: none;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: .85rem 1rem;
  color: var(--text);
  font-family: inherit;
  font-size: 1rem;
  cursor: pointer;
  text-align: left;
  transition: border-color .18s ease, box-shadow .18s ease;
}
.doc-item:hover { border-color: var(--border-glow); box-shadow: 0 0 14px color-mix(in srgb, var(--accent) 14%, transparent); }
.doc-kind {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: .68rem; letter-spacing: .2em;
  color: var(--accent);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: .15rem .5rem;
  white-space: nowrap;
}
.doc-title { letter-spacing: .06em; }

/* 节点动画 fx */
.fx-shake { animation: fx-shake .45s ease-in-out infinite; }
@keyframes fx-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-3px); }
  75% { transform: translateX(3px); }
}
.fx-flicker { animation: fx-flicker 1.3s steps(2) infinite; }
@keyframes fx-flicker {
  0%, 100% { opacity: 1; }
  50% { opacity: .35; }
}
.fx-glitch { animation: fx-glitch .5s steps(2) infinite; }
@keyframes fx-glitch {
  0%, 100% { transform: translate(0, 0); }
  20% { transform: translate(-2px, 1px); }
  40% { transform: translate(2px, -1px); }
  60% { transform: translate(-1px, -1px); }
  80% { transform: translate(1px, 1px); }
}
.fx-pulse { animation: fx-pulse 1.4s ease-in-out infinite; }
@keyframes fx-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.02); }
}
@media (prefers-reduced-motion: reduce) {
  .fx-shake, .fx-flicker, .fx-glitch, .fx-pulse { animation: none; }
}

/* 成就 */
.achievement-toast {
  position: fixed;
  top: 1.2rem; left: 50%;
  transform: translateX(-50%);
  z-index: 99;
  display: flex; flex-direction: column; gap: .5rem;
  animation: toast-in .3s ease both;
}
.ach-toast-item {
  background: var(--card);
  border: 1px solid var(--border-glow);
  border-radius: 4px;
  padding: .7rem 1.4rem;
  font-size: .95rem;
  letter-spacing: .05em;
  box-shadow: 0 12px 40px rgba(0,0,0,.45);
  color: var(--accent);
}
@keyframes toast-in {
  from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}
.ach-heading { font-size: 1.6rem; letter-spacing: .2em; margin: .2rem 0; }
.ach-count { color: var(--text-dim); font-family: 'JetBrains Mono', Consolas, monospace; font-size: .85rem; }
.ach-list {
  display: flex; flex-direction: column; gap: .7rem;
  width: min(420px, 90vw);
  margin: 1rem 0;
}
.ach-item {
  display: flex; align-items: center; gap: .9rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: .8rem 1rem;
  background: var(--card);
  text-align: left;
}
.ach-icon { font-size: 1.4rem; width: 2rem; text-align: center; }
.ach-body { display: flex; flex-direction: column; gap: .15rem; }
.ach-title { font-size: 1rem; letter-spacing: .08em; }
.ach-desc { font-size: .82rem; color: var(--text-dim); line-height: 1.6; }
.ach-locked { opacity: .55; }
.ach-locked .ach-icon { filter: grayscale(1); }

@media (max-width: 560px) {
  .card { padding: 1.5rem 1.15rem 1.7rem; }
  .ending-actions { flex-direction: column; }
  .title-main { letter-spacing: .12em; }
}
`
