import type { Story, ThemeConfig } from '../core/types.js'

/**
 * 单文件 HTML 的「外观模板」：内联 CSS + HTML 骨架拼装。
 * 与导出流程（esbuild bundle / 文件写入）分离，便于独立维护 UI 样式。
 */

/** 主题 → :root CSS 变量 */
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
.scene-objective, .evidence-notice, .tutorial-banner {
  display: flex; gap: .7rem; align-items: flex-start;
  margin-top: .9rem; padding: .8rem 1rem; border-radius: 4px;
  border: 1px solid var(--border); line-height: 1.6;
}
.scene-objective strong, .evidence-notice strong { white-space: nowrap; color: var(--accent); }
.scene-objective span, .evidence-notice span { color: var(--text-dim); }
.evidence-notice { border-color: var(--gold); background: color-mix(in srgb, var(--gold) 7%, transparent); }
.evidence-notice strong { color: var(--gold); }
.tutorial-banner { justify-content: space-between; background: color-mix(in srgb, var(--accent) 8%, var(--card)); }
.tutorial-banner div { display: flex; flex-direction: column; gap: .25rem; }
.tutorial-banner strong { color: var(--accent); letter-spacing: .08em; }
.tutorial-banner span { color: var(--text-dim); }
.tutorial-banner .btn { flex: 0 0 auto; padding: .35rem .7rem; }
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
.choice-response {
  margin: 0 0 1rem; padding: .72rem .9rem;
  border-left: 3px solid var(--accent); color: var(--text-dim);
  background: color-mix(in srgb, var(--accent) 6%, transparent);
  line-height: 1.75; white-space: pre-wrap;
}
.card-actions { display: flex; flex-direction: column; gap: .7rem; margin-top: 1.7rem; }
.choice-btn { text-align: left; letter-spacing: .05em; }

/* 高层视觉表达：5 个短枚举可组合，避免逐节点重复 CSS。 */
.type-literary { font-family: 'Noto Serif SC', 'Songti SC', 'STSong', 'SimSun', serif; }
.type-modern { font-family: 'Noto Sans SC', 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif; }
.type-mono { font-family: 'Cascadia Mono', 'JetBrains Mono', Consolas, monospace; }
.type-rounded { font-family: 'Microsoft YaHei UI', 'PingFang SC', 'Noto Sans SC', sans-serif; }
.type-rounded .title-main, .type-rounded .block-title { font-weight: 700; letter-spacing: .08em; }

.density-compact .card { padding: 1.25rem; margin-top: .7rem; }
.density-compact .card-text, .density-compact .block-para { line-height: 1.65; }
.density-compact .card-actions { gap: .42rem; margin-top: 1rem; }
.density-spacious .card { padding: 2.8rem 3rem 3.1rem; margin-top: 2rem; }
.density-spacious .card-text, .density-spacious .block-para { line-height: 2.35; font-size: 1.1rem; }
.density-spacious .card-actions { gap: 1rem; margin-top: 2.4rem; }

.shape-sharp .card, .shape-sharp .btn, .shape-sharp .block,
.shape-sharp .hud, .shape-sharp .inv-chip { border-radius: 0; }
.shape-soft .card { border-radius: 8px; }
.shape-soft .btn, .shape-soft .block, .shape-soft .hud { border-radius: 5px; }
.shape-round .card { border-radius: 24px; }
.shape-round .btn, .shape-round .block, .shape-round .hud { border-radius: 16px; }
.shape-round .choice-btn { border-radius: 999px; }

.choice-list .choice-btn {
  border-width: 0 0 1px; padding-inline: .2rem; border-radius: 0;
  background: transparent; box-shadow: none;
}
.choice-list .choice-btn::before { content: '— '; color: var(--accent); }
.choice-dialogue .choice-btn {
  width: 88%; border-radius: 18px 18px 4px 18px; align-self: flex-end;
  background: color-mix(in srgb, var(--accent) 9%, var(--card));
}
.choice-dialogue .choice-btn::before { content: '你：'; color: var(--accent); }
.choice-commands .choice-btn {
  border-width: 0 0 0 2px; border-radius: 0;
  font-family: 'Cascadia Mono', Consolas, monospace; letter-spacing: .02em;
}
.choice-commands .choice-btn::before { content: '> '; color: var(--accent); }

/* novel：让文字本身成为界面，弱化通用卡片。 */
.shell-novel.game-screen { max-width: 780px; }
.shell-novel .card { background: transparent; border-color: transparent; box-shadow: none; }
.shell-novel .game-header { border-bottom: 1px solid var(--border); padding-bottom: .75rem; }
.shell-novel.title-screen .title-main { max-width: 12em; }

/* dossier：宽版档案工作台，强调编号、边线和资料层级。 */
.shell-dossier.game-screen { max-width: 1040px; }
.shell-dossier .game-header {
  border-block: 3px double var(--border); padding: .75rem .35rem;
  text-transform: uppercase;
}
.shell-dossier .card {
  border-radius: 0; border-left: 7px solid var(--accent); box-shadow: 10px 12px 0 color-mix(in srgb, var(--border) 65%, transparent);
}
.shell-dossier .block-head, .shell-dossier .ending-badge { text-transform: uppercase; }
.shell-dossier.title-screen { align-items: flex-start; text-align: left; max-width: 1040px; margin: auto; }
.shell-dossier.title-screen .title-actions { align-items: stretch; }

/* chat：窄屏通讯界面，正文和玩家回应形成对话关系。 */
.shell-chat.game-screen { max-width: 620px; }
.shell-chat .game-header { border-radius: 18px 18px 0 0; background: var(--card); padding: 1rem; }
.shell-chat .card { background: transparent; border: 0; box-shadow: none; padding-inline: .4rem; }
.shell-chat .card-text, .shell-chat .block-para {
  width: 88%; padding: 1rem 1.15rem; border-radius: 18px 18px 18px 4px;
  background: var(--card); border: 1px solid var(--border);
}
.shell-chat .card-actions { align-items: flex-end; }
.shell-chat.title-screen .title-main { font-size: clamp(2rem, 7vw, 3rem); }

/* cinematic：全屏舞台，正文与行动压在画面底部。 */
.shell-cinematic.game-screen { max-width: none; padding: clamp(1rem, 4vw, 4rem); justify-content: flex-end; }
.shell-cinematic .game-header { position: absolute; inset: 1rem 1.5rem auto; }
.shell-cinematic .card {
  width: min(940px, 100%); margin: auto auto 0; border-width: 1px 0 0;
  border-radius: 0; background: linear-gradient(180deg, transparent, var(--card) 18%);
  box-shadow: none; padding-top: 3.5rem;
}
.shell-cinematic .card-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.shell-cinematic.title-screen { align-items: flex-start; justify-content: flex-end; text-align: left; padding: clamp(2rem, 7vw, 7rem); }
.shell-cinematic.title-screen .title-main { font-size: clamp(3rem, 10vw, 7rem); }

/* 受控叙事舞台：程序化布景、三站位角色与短促 cue，不依赖外部素材。 */
.stage-scene {
  position: relative; isolation: isolate; overflow: hidden;
  width: 100%; min-height: clamp(210px, 34vh, 390px);
  margin: 1rem auto; border: 1px solid var(--border); border-radius: 6px;
  background: color-mix(in srgb, var(--card) 75%, var(--bg));
  box-shadow: inset 0 -60px 90px color-mix(in srgb, var(--bg) 72%, transparent);
}
.shell-cinematic .stage-scene { width: min(1100px, 100%); min-height: clamp(260px, 45vh, 520px); margin-bottom: .5rem; }
.stage-set { position: absolute; inset: 0; z-index: -2; transform-origin: center 65%; }
.stage-backdrop-neutral .stage-set { background: radial-gradient(circle at 50% 75%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 48%); }
.stage-backdrop-interior .stage-set { background: linear-gradient(90deg, color-mix(in srgb, var(--border) 45%, transparent) 1px, transparent 1px) 0 0/25% 100%, linear-gradient(180deg, var(--card), var(--bg)); }
.stage-backdrop-exterior .stage-set { background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 18%, var(--bg)) 0 62%, color-mix(in srgb, var(--text-dim) 18%, var(--bg)) 62%); }
.stage-backdrop-shore .stage-set { background: radial-gradient(ellipse at 70% 18%, color-mix(in srgb, var(--gold) 40%, transparent), transparent 13%), repeating-radial-gradient(ellipse at 50% 120%, color-mix(in srgb, var(--accent) 22%, transparent) 0 8px, transparent 10px 24px), linear-gradient(var(--bg), color-mix(in srgb, var(--accent) 12%, var(--bg))); }
.stage-backdrop-industrial .stage-set { background: repeating-linear-gradient(90deg, transparent 0 48px, color-mix(in srgb, var(--text-dim) 17%, transparent) 49px 52px), linear-gradient(160deg, var(--card), var(--bg)); }
.stage-backdrop-archive .stage-set { background: repeating-linear-gradient(90deg, color-mix(in srgb, var(--gold) 8%, var(--card)) 0 18%, var(--border) 18.5% 19%, transparent 19.5% 25%), linear-gradient(var(--card), var(--bg)); }
.stage-backdrop-void .stage-set { background: radial-gradient(circle at 50% 55%, color-mix(in srgb, var(--purple) 18%, transparent), transparent 35%), #020206; }
.stage-scene::after { content: ''; position: absolute; inset: 0; z-index: 3; pointer-events: none; mix-blend-mode: screen; }
.stage-light-warm::after { background: radial-gradient(circle at 50% 20%, color-mix(in srgb, #ffb45e 30%, transparent), transparent 55%); }
.stage-light-cool::after { background: linear-gradient(color-mix(in srgb, #6ca8ff 18%, transparent), transparent 65%); }
.stage-light-night::after { background: color-mix(in srgb, #05132c 38%, transparent); mix-blend-mode: multiply; }
.stage-light-alert::after { background: linear-gradient(115deg, color-mix(in srgb, var(--danger) 24%, transparent), transparent 48%); }
.stage-light-blackout::after { background: rgba(0,0,0,.72); mix-blend-mode: multiply; }
.stage-light-spotlight::after { background: radial-gradient(ellipse at 50% 45%, transparent 0 20%, rgba(0,0,0,.68) 65%); mix-blend-mode: normal; }
.stage-camera-wide .stage-set { transform: scale(.96); }
.stage-camera-close .stage-set { transform: scale(1.12); }
.stage-camera-push .stage-set { animation: stage-camera-push 7s ease-out both; }
@keyframes stage-camera-push { from { transform: scale(1); } to { transform: scale(1.09); } }
.stage-actors { position: absolute; inset: 0; z-index: 2; }
.stage-actor { position: absolute; bottom: 0; width: min(28%, 220px); margin: 0; text-align: center; opacity: .72; transform-origin: 50% 100%; transition: opacity .25s ease, filter .25s ease, transform .25s ease; }
.stage-pos-left { left: 5%; }
.stage-pos-center { left: 50%; transform: translateX(-50%); }
.stage-pos-right { right: 5%; }
.stage-actor-figure { width: 100%; aspect-ratio: .68; display: grid; place-items: center; border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius: 48% 48% 10% 10%; background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 22%, var(--card)), color-mix(in srgb, var(--bg) 88%, black)); box-shadow: 0 0 28px color-mix(in srgb, var(--accent) 12%, transparent); }
.stage-actor-figure span { font-size: clamp(2rem, 7vw, 5rem); color: color-mix(in srgb, var(--text) 42%, transparent); }
.stage-actor figcaption { display: inline-block; transform: translateY(-.8rem); padding: .25rem .8rem; border: 1px solid var(--border); background: var(--card); color: var(--text-dim); font-size: .78rem; letter-spacing: .18em; }
.stage-focus { opacity: 1; filter: none; z-index: 2; }
.stage-pos-left.stage-focus, .stage-pos-right.stage-focus { transform: scale(1.05); }
.stage-pos-center.stage-focus { transform: translateX(-50%) scale(1.05); }
.stage-pose-open .stage-actor-figure { border-radius: 52% 52% 18% 18%; }
.stage-pose-guarded .stage-actor-figure, .stage-pose-tense .stage-actor-figure { filter: contrast(1.15); }
.stage-pose-afraid .stage-actor-figure { filter: saturate(.55) brightness(.85); }
.stage-pose-angry .stage-actor-figure { border-color: var(--danger); box-shadow: 0 0 34px color-mix(in srgb, var(--danger) 28%, transparent); }
.stage-pose-sad .stage-actor-figure { filter: saturate(.45); }
.stage-pose-shadow .stage-actor-figure { filter: brightness(.25); }
.stage-enter-fade { animation: stage-enter-fade .5s ease-out both; }
.stage-enter-slide.stage-pos-left { animation: stage-enter-left .5s ease-out both; }
.stage-enter-slide.stage-pos-right { animation: stage-enter-right .5s ease-out both; }
.stage-enter-rise { animation: stage-enter-rise .5s ease-out both; }
@keyframes stage-enter-fade { from { opacity: 0; } }
@keyframes stage-enter-left { from { opacity: 0; translate: -24px 0; } }
@keyframes stage-enter-right { from { opacity: 0; translate: 24px 0; } }
@keyframes stage-enter-rise { from { opacity: 0; translate: 0 22px; } }

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
.text-segment { white-space: pre-wrap; }
.segment-emphasis { color: var(--accent); font-weight: 700; }
.segment-italic { font-style: italic; }
.segment-blood {
  color: #a90d22; font-weight: 650; letter-spacing: .035em;
  text-shadow: 0 1px 0 #4d000b, 0 0 7px color-mix(in srgb, #d10d2c 42%, transparent);
}
.segment-whisper { color: var(--text-dim); font-size: .88em; font-style: italic; letter-spacing: .055em; }
.segment-redacted {
  color: color-mix(in srgb, var(--text) 22%, #000); letter-spacing: .08em;
  text-shadow: 0 0 1px currentColor; user-select: none;
}
.segment-glitch, .segment-corrupt {
  font-family: 'JetBrains Mono', Consolas, monospace; font-weight: 700;
  color: var(--accent); text-shadow: -.06em 0 #ef3159, .06em 0 #36dbe8;
}
.segment-terminal {
  font-family: 'JetBrains Mono', Consolas, monospace; color: #62f59a;
  background: color-mix(in srgb, #071b0f 84%, transparent); padding: .08em .3em;
}
.segment-handwritten { font-family: 'KaiTi', 'STKaiti', cursive; font-size: 1.08em; letter-spacing: .06em; }
.segment-broadcast {
  display: inline; padding: .08em .34em; color: #fff; font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: .9em; font-weight: 700; letter-spacing: .08em;
  background: linear-gradient(90deg, #d22 0 16%, #ca2 16% 32%, #2a5 32% 48%, #268 48% 64%, #52a 64% 80%, #111 80%);
  text-shadow: 0 1px 2px #000;
}
.segment-concealed { cursor: help; }
.segment-revealed { animation: segment-reveal .42s ease-out both; }
@keyframes segment-reveal {
  from { opacity: .15; filter: blur(.16em); }
  to { opacity: 1; filter: none; }
}

/* world/phase 改变时的一次性过渡；逻辑显隐仍由引擎条件控制。 */
.state-transition { animation: state-transition .38s ease-out both; }
@keyframes state-transition {
  from { opacity: .25; filter: blur(3px) saturate(.65); }
  to { opacity: 1; filter: none; }
}

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

/* 推理板 */
.deduction-heading { font-size: 1rem; letter-spacing: .12em; color: var(--accent); margin: .4rem 0 .8rem; }
.deduction-list, .evidence-list { display: flex; flex-direction: column; gap: .65rem; margin-bottom: 1.4rem; }
.deduction-item, .evidence-item {
  display: flex; gap: .8rem; align-items: flex-start; padding: .8rem;
  border: 1px solid var(--border); border-radius: 4px; cursor: pointer;
}
.deduction-item > span { display: flex; flex-direction: column; gap: .32rem; }
.deduction-item small { color: var(--text-dim); line-height: 1.45; }
.deduction-confirmed { color: var(--green); border-color: var(--green); }
.evidence-item span { display: flex; flex-direction: column; gap: .3rem; }
.evidence-item small { color: var(--text-dim); line-height: 1.5; }
.deduction-result { min-height: 1.5em; color: var(--gold); }
.deduction-guide {
  margin: 0 0 1.2rem; padding: .85rem 1rem;
  border-left: 3px solid var(--gold); background: color-mix(in srgb, var(--gold) 8%, transparent);
  color: var(--text-dim); line-height: 1.65;
}

/* 人物关系页 */
.character-list { display: flex; flex-direction: column; gap: 1rem; }
.character-card { margin-top: 1rem; }
.character-name { margin: 0 0 .5rem; font-size: 1.35rem; letter-spacing: .12em; }
.character-description { color: var(--text-dim); line-height: 1.7; }
.relation-list { display: flex; flex-wrap: wrap; gap: .5rem; margin: 1rem 0; }
.relation-chip {
  border: 1px solid var(--border); border-radius: 999px; padding: .28rem .75rem;
  color: var(--accent); font-size: .8rem;
}
.secret-list { display: flex; flex-direction: column; gap: .55rem; }
.secret-item { display: flex; flex-direction: column; gap: .3rem; padding: .7rem; border-left: 2px solid var(--border); }
.secret-item span { color: var(--text-dim); font-size: .88rem; line-height: 1.6; }
.secret-revealed { border-left-color: var(--gold); }
.secret-unknown { opacity: .68; }

/* 密码谜题 */
.puzzle-title { margin: 0 0 .7rem; font-size: 1.35rem; letter-spacing: .1em; }
.puzzle-prompt { color: var(--text-dim); line-height: 1.8; }
.puzzle-answer {
  width: 100%; margin: .8rem 0; padding: .8rem 1rem; border: 1px solid var(--border);
  border-radius: 4px; background: color-mix(in srgb, var(--card) 75%, black);
  color: var(--text); font: inherit; letter-spacing: .12em;
}
.puzzle-answer:focus { outline: 1px solid var(--accent); border-color: var(--accent); }
.puzzle-hints { color: var(--gold); line-height: 1.7; }
.puzzle-result { min-height: 1.5em; color: var(--accent); }
.puzzle-solved { color: var(--green); border: 1px solid var(--green); padding: .7rem; margin: 1rem 0; }

/* 节点动画 fx（幅度/频率由 CSS 变量控制，runtime 按 FxSpec 注入） */
.fx-shake { animation: fx-shake var(--fx-shake-dur, .45s) ease-in-out infinite; }
@keyframes fx-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(calc(var(--fx-shake-amp, 3px) * -1)); }
  75% { transform: translateX(var(--fx-shake-amp, 3px)); }
}
.fx-flicker { animation: fx-flicker var(--fx-flicker-dur, 1.3s) steps(2) infinite; }
@keyframes fx-flicker {
  0%, 100% { opacity: 1; }
  50% { opacity: var(--fx-flicker-min, .35); }
}
/* unstable：JS 在随机间隔加 .fx-burst，播放一次「连闪爆发」后移除 */
.fx-unstable { }
.fx-burst { animation: fx-burst .55s steps(1) both; }
@keyframes fx-burst {
  0%, 100% { opacity: 1; }
  8% { opacity: var(--fx-burst-min, .2); }
  16% { opacity: 1; }
  26% { opacity: var(--fx-burst-min, .2); }
  38% { opacity: 1; }
  48% { opacity: var(--fx-burst-min, .2); }
  60% { opacity: 1; }
}
.fx-glitch { animation: fx-glitch var(--fx-glitch-dur, .5s) steps(2) infinite; }
@keyframes fx-glitch {
  0%, 100% { transform: translate(0, 0); }
  20% { transform: translate(calc(var(--fx-glitch-amp, 2px) * -1), 1px); }
  40% { transform: translate(var(--fx-glitch-amp, 2px), -1px); }
  60% { transform: translate(calc(var(--fx-glitch-amp, 2px) * -0.5), -1px); }
  80% { transform: translate(calc(var(--fx-glitch-amp, 2px) * 0.5), 1px); }
}
.fx-pulse { animation: fx-pulse var(--fx-pulse-dur, 1.4s) ease-in-out infinite; }
@keyframes fx-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(var(--fx-pulse-scale, 1.02)); }
}
@media (prefers-reduced-motion: reduce) {
  .fx-shake, .fx-flicker, .fx-glitch, .fx-pulse, .fx-burst, .segment-revealed, .state-transition,
  .stage-camera-push .stage-set, .stage-enter-fade, .stage-enter-slide, .stage-enter-rise { animation: none; }
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
  .shell-dossier.title-screen { padding-inline: 1.2rem; }
  .shell-dossier .card { box-shadow: 5px 6px 0 color-mix(in srgb, var(--border) 65%, transparent); }
  .shell-cinematic.game-screen { padding: 1rem; }
  .shell-cinematic .game-header { position: static; }
  .shell-cinematic .card-actions { grid-template-columns: 1fr; }
  .density-spacious .card { padding: 1.8rem 1.25rem 2rem; }
  .choice-dialogue .choice-btn, .shell-chat .card-text, .shell-chat .block-para { width: 94%; }
}
`
