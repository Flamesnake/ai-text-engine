import type { Story } from './types.js'

/** 通用测试剧情：包含变量、道具、条件选项、onEnter（供各测试文件复用） */
export function makeStory(): Story {
  return {
    meta: { title: '测试剧情', subtitle: '单测用' },
    start: 'start',
    endings: {
      e_good: { id: 'e_good', title: '好结局', kind: 'good' },
      e_bad: { id: 'e_bad', title: '坏结局', kind: 'bad' },
      e_true: { id: 'e_true', title: '真相', kind: 'true' },
    },
    nodes: {
      start: {
        id: 'start',
        text: '开局。勇气 {courage}。',
        choices: [
          { label: '拿剑', target: 'armed', effects: { gain: ['剑'], set: { courage: 5 } } },
          { label: '空手', target: 'unarmed', effects: { set: { courage: 1 } } },
        ],
      },
      armed: {
        id: 'armed',
        text: '你有{#inventory}。',
        onEnter: { add: { courage: 3 } },
        choices: [
          { label: '战斗', target: 'fight', when: { op: 'gte', var: 'courage', value: 7 } },
          { label: '逃跑', target: 'flee' },
        ],
      },
      unarmed: {
        id: 'unarmed',
        text: '你手无寸铁。',
        choices: [
          { label: '战斗', target: 'fight' },
          { label: '求饶', target: 'beg' },
        ],
      },
      fight: {
        id: 'fight',
        text: '战！',
        choices: [],
        ending: { id: 'e_good', title: '好结局', kind: 'good' },
      },
      flee: {
        id: 'flee',
        text: '逃。',
        choices: [],
        ending: { id: 'e_bad', title: '坏结局', kind: 'bad' },
      },
      beg: {
        id: 'beg',
        text: '求饶。',
        choices: [],
        ending: { id: 'e_true', title: '真相', kind: 'true' },
      },
    },
  }
}
