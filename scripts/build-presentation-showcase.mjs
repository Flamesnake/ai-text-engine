// 生成四种视觉外壳的同内容对照页，供真实浏览器截图回归。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportToHtml } from '../dist/export/exporter.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shells = ['novel', 'dossier', 'chat', 'cinematic']

for (const shell of shells) {
  const story = {
    meta: {
      title: `${shell.toUpperCase()} · 雾港记录`,
      subtitle: '同一段内容，不同的叙事媒介',
      version: '0.5.0',
      theme: shell === 'chat' ? 'cozy' : 'dark',
      presentation: {
        shell,
        typography: shell === 'dossier' ? 'mono' : shell === 'chat' ? 'rounded' : 'literary',
        density: shell === 'cinematic' ? 'spacious' : shell === 'chat' ? 'compact' : 'balanced',
        shape: shell === 'dossier' || shell === 'cinematic' ? 'sharp' : shell === 'chat' ? 'round' : 'soft',
        choiceStyle: shell === 'dossier' ? 'list' : shell === 'chat' ? 'dialogue' : 'buttons',
      },
    },
    start: 'start',
    endings: { e_end: { id: 'e_end', title: '记录继续', kind: 'good' } },
    nodes: {
      start: {
        id: 'start',
        objective: '确认走廊尽头传来的声音来自哪里',
        text: '凌晨零点四十分，404门前的地毯是湿的。\n\n门缝里压着半张收据，墨迹还没有干。楼道尽头，废弃货梯忽然响了一声。',
        choices: [
          { label: '俯身检查门垫和收据', target: 'end' },
          { label: '先去货梯确认声音', target: 'end' },
        ],
      },
      end: {
        id: 'end', text: '你把时间和现场记进调查簿。真正的问题才刚刚出现。', choices: [],
        ending: { id: 'e_end', title: '记录继续', kind: 'good' },
      },
    },
  }
  const outputDir = path.join(root, 'projects', '_presentation-showcase', shell)
  const result = await exportToHtml(story, { outputDir })
  console.log(`${shell}: ${result.outputPath}`)
}
