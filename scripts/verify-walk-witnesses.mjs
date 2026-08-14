import { Game } from '../dist/core/engine.js'
import { walkStory } from '../dist/mcp/handlers.js'
import { loadStory } from '../dist/mcp/projects.js'

const title = process.argv[2]
const maxStates = Number(process.argv[3] ?? 100000)
const witnessMaxStates = Number(process.argv[4] ?? 25000)

if (!title) {
  console.error('用法: node scripts/verify-walk-witnesses.mjs <项目标题> [maxStates] [witnessMaxStates]')
  process.exitCode = 2
} else if (!Number.isFinite(maxStates) || !Number.isFinite(witnessMaxStates)) {
  console.error('maxStates 与 witnessMaxStates 必须是数字')
  process.exitCode = 2
} else {
  const story = await loadStory(title)
  const result = await walkStory({ title, maxStates, witnessMaxStates })
  const walk = result.walk
  const replayed = []

  for (const witness of walk.reachability.witnesses) {
    replayWitness(story, witness)
    replayed.push({
      endingId: witness.endingId,
      source: witness.source,
      steps: witness.steps,
      actions: witness.actions.length,
    })
  }

  console.log(JSON.stringify({
    title,
    reachability: {
      allEndingsProven: walk.reachability.allEndingsProven,
      unprovenEndings: walk.reachability.unprovenEndings,
      witnessSearchUsed: walk.reachability.witnessSearch.used,
      replayed,
    },
    coverage: walk.coverage,
    budget: walk.budget,
  }, null, 2))

  if (!walk.reachability.allEndingsProven) process.exitCode = 1
}

function replayWitness(story, witness) {
  const game = new Game(story)

  for (const action of witness.actions) {
    if (game.currentNode.id !== action.nodeId) {
      throw new Error(
        `${witness.endingId}: 当前节点 ${game.currentNode.id} 与见证动作节点 ${action.nodeId} 不一致`,
      )
    }

    if (action.type === 'deduction') {
      if (!game.confirmDeduction(action.deductionId, action.evidence)) {
        throw new Error(`${witness.endingId}: 无法确认推论 ${action.deductionId}`)
      }
      continue
    }

    if (action.type === 'puzzle') {
      const solution = story.puzzles?.[action.puzzleId]?.solution
      if (!solution || !game.attemptPuzzle(action.puzzleId, solution).solved) {
        throw new Error(`${witness.endingId}: 无法解开谜题 ${action.puzzleId}`)
      }
      continue
    }

    const choiceIndex = game.visibleChoices().findIndex(
      (choice) => choice.label === action.label && choice.target === action.target,
    )
    if (choiceIndex < 0) {
      throw new Error(`${witness.endingId}: 选项不可见 ${action.label} -> ${action.target}`)
    }
    game.choose(choiceIndex)
  }

  if (game.endingMeta?.id !== witness.endingId) {
    throw new Error(`${witness.endingId}: 重放结束于 ${game.endingMeta?.id ?? '非结局节点'}`)
  }
}
