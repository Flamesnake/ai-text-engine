import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'fs/promises'
import os from 'node:os'
import path from 'node:path'
import { exportToHtml, resolveTheme, THEMES } from './exporter.js'
import { makeStory } from '../core/fixtures.js'

async function tmpDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'ate-export-'))
}

async function exportWithTheme(theme: unknown): Promise<string> {
  const story = makeStory()
  story.meta.theme = theme as never
  const dir = await tmpDir()
  const result = await exportToHtml(story, { outputDir: dir })
  return readFile(result.outputPath, 'utf-8')
}

describe('exportToHtml 导出', () => {
  it('生成自包含 HTML：标题 / 剧情 JSON / 运行时 / 挂载调用齐全', async () => {
    const dir = await tmpDir()
    const result = await exportToHtml(makeStory(), { outputDir: dir })
    const html = await readFile(result.outputPath, 'utf-8')

    expect(html).toContain('<title>测试剧情</title>')
    expect(html).toContain('window.__STORY__')
    expect(html).toContain('TextAdventure.mountTextAdventure')
    expect(html).toContain('class="title-main"')
    expect(result.nodeCount).toBe(6)
    expect(result.endingCount).toBe(3)
    expect(result.sizeBytes).toBeGreaterThan(2000)
  })

  it('不引用任何外部资源（http/https 链接）', async () => {
    const dir = await tmpDir()
    const result = await exportToHtml(makeStory(), { outputDir: dir })
    const html = await readFile(result.outputPath, 'utf-8')
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('剧情文本中的 </script> 被转义，不破坏页面结构', async () => {
    const story = makeStory()
    story.nodes.start.text = '注入尝试 </script><script>alert(1)</script> 结束'
    const dir = await tmpDir()
    const result = await exportToHtml(story, { outputDir: dir })
    const html = await readFile(result.outputPath, 'utf-8')

    // 原始 </script> 不得原样出现在 story JSON 中
    expect(html).not.toMatch(/alert\(1\)<\/script>/)
    expect(html).toContain('<\\/script')
  })
})

describe('主题系统', () => {
  it('内置主题注入不同的 CSS 变量', async () => {
    const dark = await exportWithTheme('dark')
    const cyber = await exportWithTheme('cyber')
    const cozy = await exportWithTheme('cozy')
    expect(dark).toContain(`--accent: ${THEMES.dark.accent}`)
    expect(cyber).toContain(`--accent: ${THEMES.cyber.accent}`)
    expect(cyber).not.toContain(`--accent: ${THEMES.dark.accent}`)
    expect(cozy).toContain('--scheme: light')
    expect(dark).toContain('--scheme: dark')
  })

  it('自定义 ThemeConfig 覆盖默认配色', async () => {
    const html = await exportWithTheme({ accent: '#ff0000', card: '#111111' })
    expect(html).toContain('--accent: #ff0000')
    expect(html).toContain('--card: #111111')
  })

  it('未知主题名回退 dark 且不抛错', async () => {
    const html = await exportWithTheme('neon-missing-theme')
    expect(html).toContain(`--accent: ${THEMES.dark.accent}`)
  })

  it('resolveTheme 覆盖 4 套内置主题', () => {
    for (const name of ['dark', 'cyber', 'cozy', 'paper']) {
      const r = resolveTheme(name)
      expect(r.colors).toBe(THEMES[name])
    }
  })
})
