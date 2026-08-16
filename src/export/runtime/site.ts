/**
 * 拟态网站渲染（P2-2 拆分）：站点头/尾、列表卡片、页面头等纯渲染函数。
 * 全部为纯函数，接收显式 ctx，不持有共享状态。
 */
import type { Choice, Story, StoryNode } from '../../core/types.js'
import type { Game } from '../../core/engine.js'

export interface SiteRenderCtx {
  story: Story
  game: Game
  esc: (text: string) => string
  muteButtonHtml: () => string
}

export function siteDefaultLayout(kind: string): string {
  switch (kind) {
    case 'news': return 'article'
    case 'forum': return 'thread'
    case 'blog': return 'post'
    case 'mail': return 'thread'
    default: return 'article'
  }
}

export function siteTitleBadge(story: Story): string {
  const site = story.meta.site
  if (!site) return 'TEXT ADVENTURE'
  const esc = escDefault
  switch (site.kind) {
    case 'news': return esc(site.locale ?? '独立新闻档案')
    case 'forum': return esc(site.locale ?? '在线社区')
    case 'blog': return esc(site.locale ?? '独立博客')
    case 'mail': return esc(site.locale ?? '私人邮箱')
  }
}

export function siteStartLabel(story: Story): string {
  switch (story.meta.site?.kind) {
    case 'news': return '浏览最新报道'
    case 'forum': return '进入版块'
    case 'blog': return '进入博客'
    case 'mail': return '打开收件箱'
    default: return '开始游戏'
  }
}

export function siteContinueLabel(story: Story): string {
  switch (story.meta.site?.kind) {
    case 'news': return '继续浏览'
    case 'forum': return '继续逛版'
    case 'blog': return '继续阅读'
    case 'mail': return '继续查看'
    default: return '继续上次'
  }
}

export function siteClearLabel(story: Story): string {
  switch (story.meta.site?.kind) {
    case 'news': return '清除浏览记录'
    case 'forum': return '退出并清除记录'
    case 'blog': return '清除阅读记录'
    case 'mail': return '清除邮箱记录'
    default: return '清除存档'
  }
}

export function siteArchiveLabel(story: Story): string {
  switch (story.meta.site?.kind) {
    case 'news': return '阅读档案'
    case 'forum': return '归档'
    case 'blog': return '归档'
    case 'mail': return '归档'
    default: return '成就'
  }
}

export function renderGameHeader(ctx: SiteRenderCtx, step: number): string {
  const { story, game, esc, muteButtonHtml } = ctx
  const site = story.meta.site
  if (!site) {
    return `<header class="game-header">
      <span class="game-title">${esc(story.meta.title)}</span>
      <span class="game-step">第 ${step} 步</span>
      ${muteButtonHtml()}
    </header>`
  }
  const tools = `<nav class="site-tools" aria-label="调查工具">${muteButtonHtml()}</nav>`
  switch (site.kind) {
    case 'news':
      return `<header class="game-header site-header site-header-news">
        <div class="site-utility"><span>${esc(site.locale ?? '独立新闻档案')}</span><span>第 ${step} 页</span></div>
        <div class="site-masthead"><span class="site-name">${esc(site.name)}</span>${site.tagline ? `<span class="site-tagline">${esc(site.tagline)}</span>` : ''}</div>
        ${tools}
      </header>`
    case 'forum':
      return `<header class="game-header site-header site-header-forum">
        <div class="site-utility"><span>${esc(site.locale ?? '版块导航')}</span><span>在线 ${game.stepCount} 步</span></div>
        <div class="site-masthead"><span class="site-name">${esc(site.name)}</span>${site.tagline ? `<span class="site-tagline">${esc(site.tagline)}</span>` : ''}</div>
        ${tools}
      </header>`
    case 'blog':
      return `<header class="game-header site-header site-header-blog">
        <div class="site-utility"><span>${esc(site.locale ?? '博客')}</span><span>第 ${step} 篇</span></div>
        <div class="site-masthead"><span class="site-name">${esc(site.name)}</span>${site.tagline ? `<span class="site-tagline">${esc(site.tagline)}</span>` : ''}</div>
        ${tools}
      </header>`
    case 'mail':
      return `<header class="game-header site-header site-header-mail">
        <div class="site-utility"><span>${esc(site.locale ?? '邮箱')}</span><span>${game.state.docs.length} 附件</span></div>
        <div class="site-masthead"><span class="site-name">${esc(site.name)}</span>${site.tagline ? `<span class="site-tagline">${esc(site.tagline)}</span>` : ''}</div>
        ${tools}
      </header>`
  }
}

export function renderPageHeader(ctx: SiteRenderCtx, node: StoryNode): string {
  const { story, game, esc } = ctx
  const site = story.meta.site
  if (!site || (node.stage && node.stage !== 'clear')) return ''
  const page = node.page ?? {}
  const layout = page.layout ?? siteDefaultLayout(site.kind)
  const headline = page.headline ?? node.objective ?? story.meta.subtitle ?? story.meta.title
  const bylinePrefix = site.kind === 'news' ? '记者' : site.kind === 'forum' ? '用户' : site.kind === 'blog' ? '作者' : '发件人'
  const details = [page.byline ? `${bylinePrefix} ${page.byline}` : '', page.timestamp ?? ''].filter(Boolean)
  return `<header class="web-page-header page-layout-${layout}" data-web-page="${layout}">
    ${page.section ? `<span class="web-page-section">${esc(page.section)}</span>` : ''}
    <h1 class="web-page-headline">${esc(game.interpolate(headline))}</h1>
    ${details.length > 0 ? `<p class="web-page-meta">${details.map(esc).join('<span aria-hidden="true"> · </span>')}</p>` : ''}
  </header>`
}

export function defaultChoiceSlot(index: number, composition?: string): string {
  switch (composition) {
    case 'lead-grid':
      return index === 0 ? 'lead' : 'grid'
    case 'lead-grid-sidebar':
      return index === 0 ? 'lead' : index === 1 ? 'grid' : index === 2 ? 'sidebar' : 'feed'
    case 'grid':
      return 'grid'
    case 'feed':
      return 'feed'
    default:
      return index === 0 ? 'lead' : 'grid'
  }
}

/** 选项渲染：站点列表页使用卡片/行式呈现；无站点时保持通用按钮。 */
export function renderChoiceButtons(ctx: SiteRenderCtx, node: StoryNode, choices: Choice[]): string {
  const { story, game, esc } = ctx
  const site = story.meta.site
  const layout = node.page?.layout
  const composition = node.page?.composition
  return choices
    .map((choice, index) => {
      const label = esc(game.interpolate(choice.label))
      const attrs = `data-choice="${index}" data-choice-label="${esc(choice.label)}" data-choice-target="${esc(choice.target)}" style="--choice-i:${index}"`
      if (!site || !layout) {
        return `<button class="btn choice-btn" ${attrs}>${label}</button>`
      }
      const card = choice.card
      const badge = card?.badge ? `<span class="choice-badge">${esc(card.badge)}</span>` : ''
      const media = card?.media ? `<span class="choice-media media-${esc(card.media)}" aria-hidden="true"></span>` : ''
      const summary = card?.summary ? `<span class="choice-summary">${esc(game.interpolate(card.summary))}</span>` : ''

      if (site.kind === 'news' && layout === 'frontpage') {
        const slot = card?.slot ?? defaultChoiceSlot(index, composition)
        return `<button class="btn choice-btn choice-card choice-slot-${slot}" ${attrs}>${media}<span class="choice-body"><span class="choice-title">${label}${badge}</span>${summary}</span></button>`
      }
      if (site.kind === 'forum' && layout === 'board') {
        const meta = [node.page?.byline ?? '', node.page?.timestamp ?? ''].filter(Boolean).join(' · ')
        return `<button class="btn choice-btn forum-row" ${attrs}><span class="choice-body"><span class="choice-title">${label}${badge}</span>${summary}</span>${meta ? `<span class="choice-meta">${esc(meta)}</span>` : ''}</button>`
      }
      if (site.kind === 'blog' && layout === 'index') {
        const meta = [node.page?.byline ?? '', node.page?.timestamp ?? ''].filter(Boolean).join(' · ')
        return `<button class="btn choice-btn blog-card" ${attrs}>${media}<span class="choice-body"><span class="choice-title">${label}${badge}</span>${summary}</span>${meta ? `<span class="choice-meta">${esc(meta)}</span>` : ''}</button>`
      }
      if (site.kind === 'mail' && layout === 'inbox') {
        const meta = [node.page?.byline ?? '', node.page?.timestamp ?? ''].filter(Boolean).join(' · ')
        return `<button class="btn choice-btn mail-row" ${attrs}><span class="choice-body"><span class="choice-title">${label}${badge}</span>${summary}</span>${meta ? `<span class="choice-meta">${esc(meta)}</span>` : ''}</button>`
      }
      return `<button class="btn choice-btn" ${attrs}>${label}</button>`
    })
    .join('')
}

const escDefault = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')