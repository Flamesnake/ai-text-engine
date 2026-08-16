import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile } from 'fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  checkRuntimeFreshness,
  exportToHtml,
  latestSourceMtime,
  parseRuntimeBanner,
  resolveTheme,
  RUNTIME_BANNER_RE,
  storyNeedsStage,
  THEMES,
} from './exporter.js'
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
    // 运行时代码里可能含有 http 字样（例如 Three.js 的常量字符串），
    // 这里只检查真正会触发外部请求的标签引用。
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:\/\//)
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

describe('runtime 新鲜度护栏（P1-2）', () => {
  it('解析 build-runtime 注入的 banner', () => {
    expect(parseRuntimeBanner('')).toBeNull()
    expect(parseRuntimeBanner('var x = 1')).toBeNull()
    expect(parseRuntimeBanner('/* talespindle-runtime: built=1000 srcMtime=500 */\n(()=>{})();')).toEqual({
      built: 1000,
      srcMtime: 500,
    })
    expect(`${RUNTIME_BANNER_RE}`).toContain('srcMtime')
  })

  it('bundle 比源码旧 → 过期警告；比源码新 → 不警告', async () => {
    // 真实源码 mtime 必然大于 0
    expect(await latestSourceMtime()).toBeGreaterThan(0)
    const stale = '/* talespindle-runtime: built=1 srcMtime=0 */\n(()=>{})();'
    const warning = await checkRuntimeFreshness(stale)
    expect(warning).toContain('过期')

    const future = Date.now() + 1000 * 3600 * 24 * 365
    const fresh = `/* talespindle-runtime: built=${future} srcMtime=${future} */\n(()=>{})();`
    expect(await checkRuntimeFreshness(fresh)).toBeUndefined()
  })

  it('旧产物无 banner：无从比较，不警告', async () => {
    expect(await checkRuntimeFreshness('(()=>{})();')).toBeUndefined()
  })
})

describe('双 bundle 自动选型（P1-7）', () => {
  it('storyNeedsStage：任意非 clear 的 stage cue 需要 full bundle', () => {
    const plain = makeStory()
    expect(storyNeedsStage(plain)).toBe(false)

    const withStage = makeStory()
    withStage.nodes.start.stage = { backdrop: 'void', lighting: 'blackout' }
    expect(storyNeedsStage(withStage)).toBe(true)

    const onlyClear = makeStory()
    onlyClear.nodes.start.stage = 'clear'
    expect(storyNeedsStage(onlyClear)).toBe(false)
  })

  it('无舞台作品导出使用 lite bundle：体积显著小于含舞台版本', async () => {
    const plain = makeStory()
    const staged = makeStory()
    staged.nodes.start.stage = { backdrop: 'archive', lighting: 'spotlight', camera: 'wide' }
    staged.nodes.start.tags = ['cutscene']

    const dirPlain = await tmpDir()
    const plainResult = await exportToHtml(plain, { outputDir: dirPlain })
    const dirStaged = await tmpDir()
    const stagedResult = await exportToHtml(staged, { outputDir: dirStaged })

    // lite 不含 three.js（WebGL 特征字符串），full 含
    const plainHtml = await readFile(plainResult.outputPath, 'utf-8')
    const stagedHtml = await readFile(stagedResult.outputPath, 'utf-8')
    expect(plainHtml).not.toContain('WebGLRenderer')
    expect(stagedHtml).toContain('WebGLRenderer')

    // 体积差异显著（three.js ~600KB 原始 / ~150KB minify）
    expect(plainResult.sizeBytes).toBeLessThan(stagedResult.sizeBytes)
    expect(plainResult.sizeBytes).toBeLessThan(200_000)
    expect(stagedResult.sizeBytes).toBeGreaterThan(plainResult.sizeBytes + 20_000)
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

  it('导出包含四种界面外壳样式与紧凑的 presentation 配置', async () => {
    const story = makeStory()
    story.meta.presentation = { shell: 'dossier', choiceStyle: 'list' }
    const dir = await tmpDir()
    const result = await exportToHtml(story, { outputDir: dir })
    const html = await readFile(result.outputPath, 'utf-8')

    for (const shell of ['novel', 'dossier', 'chat', 'cinematic']) {
      expect(html).toContain(`.shell-${shell}`)
    }
    expect(html).toContain('"presentation":{"shell":"dossier","choiceStyle":"list"}')
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

  it('舞台调色板经 CSS 变量注入（P2-1）：CSS 回退与 3D 舞台共用 stage-palette 色源', async () => {
    const html = await exportWithTheme('dark')
    // stage-palette.ts 的 void 背景色（#050308）同步进 :root 变量
    expect(html).toContain('--stage-bg-void: #050308')
    // CSS 回退舞台使用该变量而非硬编码色值
    expect(html).toContain('var(--stage-bg-void')
    expect(html).not.toContain('background: radial-gradient(circle at 50% 55%, color-mix(in srgb, var(--purple) 18%, transparent), transparent 35%), #020206')
  })
})
