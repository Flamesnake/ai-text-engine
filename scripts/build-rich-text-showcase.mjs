// 生成富文本最小纵向样板：受控样式、条件遮挡、证据解锁与单 HTML 导出。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportToHtml } from '../dist/export/exporter.js'
import { parseStory, SCHEMA_VERSION } from '../dist/core/schema.js'
import { validate } from '../dist/core/validate.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const story = parseStory({
  meta: {
    title: '红字病历 · 富文本样板',
    subtitle: '被涂黑的时间会在调查后恢复',
    version: SCHEMA_VERSION,
    theme: 'dark',
    presentation: { shell: 'dossier', typography: 'mono', density: 'balanced', shape: 'sharp', choiceStyle: 'list' },
  },
  start: 'record',
  evidence: {
    e_clock: { id: 'e_clock', title: '停摆的护士站时钟', description: '秒针卡在 03:17。', kind: 'observation' },
  },
  endings: { e_read: { id: 'e_read', title: '被恢复的时间', kind: 'true' } },
  nodes: {
    record: {
      id: 'record',
      objective: '找出病历中被涂黑的时间',
      text: '急诊记录：患者于 03:17 被送入。护士站信号中断。',
      blocks: [
        {
          type: 'title', title: '急诊记录 / 7-B', text: '急诊记录 / 7-B',
          segments: [{ text: '急诊记录 ', style: 'emphasis' }, { text: '/ 7-B', style: 'terminal' }],
        },
        {
          type: 'para', text: '患者于 03:17 被送入。',
          segments: [
            { text: '患者于 ' },
            { text: '03:17', style: 'redacted', revealWhen: { op: 'has', var: '#evidence', value: 'e_clock' } },
            { text: ' 被送入。', style: 'blood' },
          ],
        },
        {
          type: 'note', title: '护士站电视', text: 'SIGNAL LOST：记录时间 03:17。',
          segments: [
            { text: ' SIGNAL LOST ', style: 'broadcast' },
            { text: ' 记录时间 ' },
            { text: '03:17', style: 'glitch', revealWhen: { op: 'has', var: '#evidence', value: 'e_clock' } },
            { text: '……别相信值班表。', style: 'whisper' },
          ],
        },
      ],
      choices: [
        {
          label: '检查护士站停摆的时钟', target: 'record',
          when: { op: 'not_has', var: '#evidence', value: 'e_clock' },
          effects: { gainEvidence: ['e_clock'] },
        },
        {
          label: '读出恢复后的时间', target: 'end',
          when: { op: 'has', var: '#evidence', value: 'e_clock' },
        },
      ],
    },
    end: {
      id: 'end', text: '被涂黑的不是姓名，而是医院想从时间线上删掉的十七分钟。', choices: [],
      ending: { id: 'e_read', title: '被恢复的时间', kind: 'true' }, sfx: 'ending_true',
    },
  },
})

const problems = validate(story)
if (problems.length > 0) throw new Error(`showcase validate failed: ${problems.join('; ')}`)
const result = await exportToHtml(story, { outputDir: path.join(root, 'projects', '_rich-text-showcase', 'dist') })
console.log(`rich text showcase: ${result.outputPath}`)
