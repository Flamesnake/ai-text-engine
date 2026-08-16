import { z } from 'zod'
import { validate } from '../../core/validate.js'
import { CharacterSchema } from '../../core/schema.js'
import type { Character } from '../../core/types.js'
import * as projects from '../projects.js'
import type { ToolDef } from '../tool-def.js'

/**
 * 人物域：结构人物、关系维度与秘密的定义。
 */

export async function upsertCharacter(args: { title: string; character: Character }): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  if (!args.character?.id) throw new Error('character.id 不能为空')
  story.characters ??= {}
  const created = !story.characters[args.character.id]
  story.characters[args.character.id] = args.character
  await projects.saveStory(story)
  const problems = validate(story)
  return {
    ok: true, created, characterId: args.character.id,
    count: Object.keys(story.characters).length,
    validate: problems, validatePass: problems.length === 0,
  }
}

export async function deleteCharacter(args: { title: string; characterId: string }): Promise<unknown> {
  const story = await projects.loadStory(args.title)
  story.characters ??= {}
  if (!story.characters[args.characterId]) return { ok: true, deleted: false }
  delete story.characters[args.characterId]
  await projects.saveStory(story)
  const problems = validate(story)
  return { ok: true, deleted: true, characterId: args.characterId, validate: problems, validatePass: problems.length === 0 }
}

export const CHARACTER_TOOLS: ToolDef[] = [
  {
    name: 'story_upsert_character',
    description: '创建或覆盖一个人物定义，包含关系维度与秘密。节点效果可调整关系、记录记忆和揭示秘密。',
    schema: { title: z.string(), character: CharacterSchema },
    handler: (args) => upsertCharacter(args),
  },
  {
    name: 'story_delete_character',
    description: '删除一个人物定义；删除后请根据校验结果清理关系与秘密引用。',
    schema: { title: z.string(), characterId: z.string() },
    handler: (args) => deleteCharacter(args),
  },
]