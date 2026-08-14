import { Window } from 'happy-dom'
import { walkStory } from '../dist/mcp/handlers.js'
import { loadStory } from '../dist/mcp/projects.js'
import {
  replayFailureWitnessInDomAndDestroy,
  replayWitnessInDomAndDestroy,
} from '../dist/export/witness-replay.js'

const nativeTimers = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
}

const title = process.argv[2]
const maxStates = Number(process.argv[3] ?? 100000)
const witnessMaxStates = Number(process.argv[4] ?? 25000)

if (!title) {
  console.error('用法: node scripts/verify-dom-witnesses.mjs <项目标题> [maxStates] [witnessMaxStates]')
  process.exitCode = 2
} else if (!Number.isFinite(maxStates) || !Number.isFinite(witnessMaxStates)) {
  console.error('maxStates 与 witnessMaxStates 必须是数字')
  process.exitCode = 2
} else {
  const story = await loadStory(title)
  const result = await walkStory({ title, maxStates, witnessMaxStates })
  const walk = result.walk
  const replayed = []
  const replayedFailures = []

  for (const witness of walk.reachability.witnesses) {
    const window = new Window()
    installDomGlobals(window)
    const root = document.createElement('div')
    document.body.append(root)
    try {
      const report = await replayWitnessInDomAndDestroy(root, story, witness, {
        saveKey: `verify:dom-witness:${title}:${witness.endingId}`,
        storage: localStorage,
      })
      replayed.push({ ...report, source: witness.source, steps: witness.steps })
    } finally {
      window.close()
      restoreTimers()
    }
  }

  for (const witness of walk.failures.witnesses) {
    const window = new Window()
    installDomGlobals(window)
    const root = document.createElement('div')
    document.body.append(root)
    try {
      replayedFailures.push(await replayFailureWitnessInDomAndDestroy(root, story, witness, {
        saveKey: `verify:dom-failure:${title}:${witness.kind}:${witness.nodeId}`,
        storage: localStorage,
      }))
    } finally {
      window.close()
      restoreTimers()
    }
  }

  console.log(JSON.stringify({
    title,
    reachability: {
      allEndingsProven: walk.reachability.allEndingsProven,
      unprovenEndings: walk.reachability.unprovenEndings,
      witnessSearchUsed: walk.reachability.witnessSearch.used,
      domReplayed: replayed,
    },
    failures: {
      complete: walk.failures.complete,
      domReplayed: replayedFailures,
    },
    coverage: walk.coverage,
    budget: walk.budget,
  }, null, 2))

  if (!walk.reachability.allEndingsProven || replayedFailures.length > 0) process.exitCode = 1
}

function restoreTimers() {
  globalThis.setTimeout = nativeTimers.setTimeout
  globalThis.clearTimeout = nativeTimers.clearTimeout
}

function installDomGlobals(window) {
  globalThis.window = window
  globalThis.document = window.document
  globalThis.HTMLElement = window.HTMLElement
  globalThis.localStorage = window.localStorage
  // 运行时特效使用全局 timer；交给 happy-dom 管理，window.close() 才能清理结局页的 unstable 定时器。
  globalThis.setTimeout = window.setTimeout.bind(window)
  globalThis.clearTimeout = window.clearTimeout.bind(window)
  globalThis.Audio = class {
    play() { return Promise.resolve() }
  }
}
