import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Story, ThemeConfig } from '../core/types.js'
import { stageBackdropCssVars } from './stage-palette.js'

/** 构建期注入的独立样式表（P2-5）：CSS 独立文件可高亮可 lint，模板函数签名不变。 */
export const TEMPLATE_CSS: string = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'template.css'),
  'utf8',
)

/**
 * 单文件 HTML 的「外观模板」：内联 CSS + HTML 骨架拼装。
 * 与导出流程（esbuild bundle / 文件写入）分离，便于独立维护 UI 样式。
 */

/** 主题 → :root CSS 变量（含舞台调色，P2-1：与 3D 舞台共用 stage-palette 色源） */
export function cssVars(theme: { colors: ThemeConfig; scheme: 'dark' | 'light' }): string {
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
  ${stageBackdropCssVars()}
}`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 组装自包含 HTML */
export function renderHtmlTemplate(
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
${TEMPLATE_CSS}
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
