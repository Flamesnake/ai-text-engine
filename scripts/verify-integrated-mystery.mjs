// 以真实运行时 DOM 操作验收《雨夜遗嘱》的完整真相路线。
import { readFile } from 'node:fs/promises'
import { Window } from 'happy-dom'
import { mountTextAdventure } from '../dist/export/runtime.js'

const story = JSON.parse(await readFile(new URL('../projects/雨夜遗嘱/story.json', import.meta.url), 'utf8'))
const window = new Window()
globalThis.window = window
globalThis.document = window.document
globalThis.HTMLElement = window.HTMLElement
globalThis.localStorage = window.localStorage
globalThis.Audio = class { play() { return Promise.resolve() } }

const root = document.createElement('div')
document.body.append(root)
mountTextAdventure(root, story, { saveKey: 'verify:integrated-mystery', storage: localStorage })

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
function click(selector, message = selector) {
  const element = root.querySelector(selector)
  assert(element, `找不到按钮：${message}`)
  element.click()
}
function choose(label) {
  const button = [...root.querySelectorAll('.choice-btn')].find((item) => item.textContent.trim() === label)
  assert(button, `当前场景找不到选项「${label}」；实际为：${[...root.querySelectorAll('.choice-btn')].map((item) => item.textContent.trim()).join(' / ')}`)
  button.click()
}

click('[data-action="start"]', '开始游戏')
choose('封住大门，开始调查')

const openingActions = [...root.querySelectorAll('.choice-btn')].map((item) => item.textContent.trim())
assert(openingActions.length >= 6, `调查大厅有效行动不足：${openingActions.length}`)
assert(openingActions.includes('检查尸体和药瓶'), '调查入口不可发现')
assert(root.querySelector('.scene-objective')?.textContent.includes('推理板组合验证'), '调查大厅没有显示当前目标')

choose('检查尸体和药瓶')
choose('带着药瓶回到大厅')
choose('与乔岚谈谈')
choose('指出欠条墨迹过新，答应先不公开')
choose('记下证词，返回大厅')
choose('调查二楼书房')

assert(root.querySelector('[data-puzzle-choice="study_safe"]')?.textContent.includes('打开肖像后的暗格'), '场景中没有醒目的暗格行动')
choose('取下肖像，查看背面')
choose('记住题字，回到暗格前')
click('[data-puzzle-choice="study_safe"]', '尝试打开暗格')
const answer = root.querySelector('[data-puzzle-answer="study_safe"]')
assert(answer, '谜题答案输入框不存在')
answer.value = '1907'
click('[data-action="attempt-puzzle"]', '提交暗格密码')
assert(root.querySelector('[data-puzzle-result]')?.textContent.includes('谜题已解开'), '正确密码没有解开谜题')
click('[data-action="back"]', '返回书房')
choose('暗格已开，检查其中的残页')
choose('带着账页返回大厅')

assert(root.querySelector('[data-deduction-choice]')?.textContent.includes('整理线索并推理'), '获得证据后没有出现主要推理行动')
click('[data-deduction-choice]', '整理线索并推理')
assert(root.querySelector('.game-title')?.textContent.trim() === '推理板', '推理功能仍使用含糊的页面名称')
assert(root.querySelector('[data-deduction-progress="butler_murder"]')?.textContent.includes('必需证据 2/2'), '推理板没有显示必需证据进度')
const ownedEvidence = [...root.querySelectorAll('[data-evidence]')].map((item) => item.value)
for (const required of ['swapped_bottle', 'ledger_page', 'son_testimony']) {
  assert(ownedEvidence.includes(required), `缺少真相路线证据：${required}`)
}
root.querySelectorAll('[data-evidence]').forEach((input) => input.click())
click('[data-action="confirm-deduction"]', '验证推论')
assert(root.querySelector('[data-deduction-result]')?.textContent.includes('推论成立'), '完整证据未能形成推论')
click('[data-action="back"]', '返回大厅')
choose('用完整证据指控周衡')

assert(root.querySelector('.ending-title')?.textContent.trim() === '七分钟的谋杀', '未抵达真相结局')
console.log(JSON.stringify({
  ok: true,
  openingActionCount: openingActions.length,
  evidenceUsed: ownedEvidence,
  ending: root.querySelector('.ending-title')?.textContent.trim(),
}, null, 2))
