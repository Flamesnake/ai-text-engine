import { describe, expect, it } from 'vitest'
import { Game } from './engine.js'
import { validate } from './validate.js'
import { walkAllEndings } from './walk.js'
import type { Story } from './types.js'

function makeRelationshipStory(): Story {
  return {
    meta: { title: '女仆的秘密' },
    start: 'start',
    characters: {
      maid: {
        id: 'maid', name: '林夏', description: '山庄女仆。',
        relations: { trust: { label: '信任', initial: 0, min: -3, max: 3 } },
        secrets: {
          hidden_corridor: {
            id: 'hidden_corridor', title: '隐藏走廊', description: '她看见管家进入隐藏走廊。',
          },
        },
      },
    },
    evidence: {
      corridor_testimony: {
        id: 'corridor_testimony', title: '隐藏走廊证词',
        description: '女仆看见管家进入隐藏走廊。', kind: 'testimony',
      },
    },
    nodes: {
      start: {
        id: 'start', text: '女仆请求你不要公开她违反宵禁的事。',
        choices: [{
          label: '答应替她保密', target: 'talk',
          effects: {
            adjustRelation: [{ characterId: 'maid', stat: 'trust', add: 2 }],
            remember: ['protected_maid'],
          },
        }],
      },
      talk: {
        id: 'talk', text: '她观察着你的反应。',
        choices: [
          {
            label: '请她说出真正看见的事', target: 'confession',
            when: { op: 'gte', var: '#relation:maid:trust', value: 2 },
          },
          { label: '结束谈话', target: 'silent' },
        ],
      },
      confession: {
        id: 'confession', text: '她终于说出了隐藏走廊。',
        onEnter: {
          revealSecrets: ['maid:hidden_corridor'],
          gainEvidence: ['corridor_testimony'],
        },
        choices: [], ending: { id: 'e_confession', title: '坦白', kind: 'true' },
      },
      silent: {
        id: 'silent', text: '她保持沉默。', choices: [],
        ending: { id: 'e_silent', title: '沉默', kind: 'bad' },
      },
    },
    endings: {
      e_confession: { id: 'e_confession', title: '坦白', kind: 'true' },
      e_silent: { id: 'e_silent', title: '沉默', kind: 'bad' },
    },
  }
}

describe('人物关系、记忆与秘密', () => {
  it('玩家行为改变关系并留下记忆，关系门槛解锁秘密和证据', () => {
    const game = new Game(makeRelationshipStory())
    expect(game.state.relations.maid.trust).toBe(0)

    game.choose(0)
    expect(game.state.relations.maid.trust).toBe(2)
    expect(game.state.memories).toContain('protected_maid')
    expect(game.visibleChoices().map((choice) => choice.label)).toContain('请她说出真正看见的事')

    game.choose(0)
    expect(game.state.revealedSecrets).toContain('maid:hidden_corridor')
    expect(game.state.evidence).toContain('corridor_testimony')
  })

  it('校验不存在的角色、关系维度与秘密引用', () => {
    const story = makeRelationshipStory()
    story.nodes.start.choices[0].effects = {
      adjustRelation: [{ characterId: 'ghost', stat: 'trust', add: 1 }],
      revealSecrets: ['maid:ghost_secret'],
    }
    story.nodes.talk.choices[0].when = { op: 'gte', var: '#relation:maid:courage', value: 1 }

    const problems = validate(story).join('\n')
    expect(problems).toContain('关系效果引用了不存在的角色 "ghost"')
    expect(problems).toContain('秘密效果引用了不存在的秘密 "maid:ghost_secret"')
    expect(problems).toContain('关系条件引用了角色 "maid" 未定义的维度 "courage"')
  })

  it('路径探索理解关系、记忆与秘密效果', () => {
    const result = walkAllEndings(makeRelationshipStory())
    expect(result.unreachableEndings).toEqual([])
    expect(result.endings.map((ending) => ending.endingId)).toEqual(['e_confession', 'e_silent'])
  })
})
