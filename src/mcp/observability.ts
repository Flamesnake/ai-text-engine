import { Buffer } from 'node:buffer'

interface ToolAggregate {
  tool: string
  calls: number
  failures: number
  requestBytes: number
  responseBytes: number
  durationMs: number
}

export interface ObservabilitySnapshot {
  startedAt: string
  capturedAt: string
  totals: {
    calls: number
    failures: number
    requestBytes: number
    responseBytes: number
    approximateTokens: number
    durationMs: number
    fullReads: number
    partialReads: number
    transitionReviews: number
    validations: number
    walks: number
    exports: number
    repeatedOverwrites: number
  }
  tools: ToolAggregate[]
  resources: Array<{ resource: string; writes: number; overwrites: number }>
}

let startedAt = new Date()
const tools = new Map<string, ToolAggregate>()
const resources = new Map<string, number>()

/** 包装一次 MCP 工具执行；只保留聚合数字和资源 id，不保存请求/响应正文。 */
export async function observeToolCall<T>(
  tool: string,
  args: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const requestBytes = jsonBytes(args)
  const start = performance.now()
  let failed = false
  let responseBytes = 0
  try {
    const result = await run()
    responseBytes = jsonBytes(result)
    return result
  } catch (error) {
    failed = true
    responseBytes = error instanceof Error ? Buffer.byteLength(error.message, 'utf8') : 0
    throw error
  } finally {
    const aggregate = tools.get(tool) ?? {
      tool, calls: 0, failures: 0, requestBytes: 0, responseBytes: 0, durationMs: 0,
    }
    aggregate.calls++
    aggregate.failures += failed ? 1 : 0
    aggregate.requestBytes += requestBytes
    aggregate.responseBytes += responseBytes
    aggregate.durationMs += performance.now() - start
    tools.set(tool, aggregate)
    const resource = writeResource(tool, args)
    if (resource && !failed) resources.set(resource, (resources.get(resource) ?? 0) + 1)
  }
}

export function snapshotObservability(): ObservabilitySnapshot {
  const toolRows = [...tools.values()]
    .map((item) => ({ ...item, durationMs: round(item.durationMs) }))
    .sort((a, b) => b.durationMs - a.durationMs || b.calls - a.calls || a.tool.localeCompare(b.tool))
  const calls = toolRows.reduce((sum, item) => sum + item.calls, 0)
  const failures = toolRows.reduce((sum, item) => sum + item.failures, 0)
  const requestBytes = toolRows.reduce((sum, item) => sum + item.requestBytes, 0)
  const responseBytes = toolRows.reduce((sum, item) => sum + item.responseBytes, 0)
  const durationMs = toolRows.reduce((sum, item) => sum + item.durationMs, 0)
  const resourceRows = [...resources.entries()]
    .map(([resource, writes]) => ({ resource, writes, overwrites: Math.max(0, writes - 1) }))
    .sort((a, b) => b.overwrites - a.overwrites || b.writes - a.writes || a.resource.localeCompare(b.resource))
  return {
    startedAt: startedAt.toISOString(),
    capturedAt: new Date().toISOString(),
    totals: {
      calls,
      failures,
      requestBytes,
      responseBytes,
      approximateTokens: Math.ceil((requestBytes + responseBytes) / 4),
      durationMs: round(durationMs),
      fullReads: tools.get('story_get')?.calls ?? 0,
      partialReads: tools.get('story_get_node')?.calls ?? 0,
      transitionReviews: tools.get('story_review_transitions')?.calls ?? 0,
      validations: tools.get('story_validate')?.calls ?? 0,
      walks: tools.get('story_walk')?.calls ?? 0,
      exports: tools.get('story_export')?.calls ?? 0,
      repeatedOverwrites: resourceRows.reduce((sum, item) => sum + item.overwrites, 0),
    },
    tools: toolRows,
    resources: resourceRows,
  }
}

export function resetObservability(): void {
  startedAt = new Date()
  tools.clear()
  resources.clear()
}

function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    return 0
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function writeResource(tool: string, args: unknown): string | null {
  if (!args || typeof args !== 'object') return null
  const data = args as Record<string, any>
  if (tool === 'story_patch_choice') {
    return typeof data.nodeId === 'string' && Number.isInteger(data.choiceIndex)
      ? `choice:${data.nodeId}[${data.choiceIndex}]`
      : null
  }
  const specs: Record<string, [string, string]> = {
    story_upsert_node: ['node', 'id'],
    story_upsert_achievement: ['achievement', 'id'],
    story_upsert_document: ['document', 'id'],
    story_upsert_evidence: ['evidence', 'id'],
    story_upsert_deduction: ['deduction', 'id'],
    story_upsert_character: ['character', 'id'],
    story_upsert_puzzle: ['puzzle', 'id'],
  }
  const spec = specs[tool]
  if (!spec) return null
  const id = data[spec[0]]?.[spec[1]]
  return typeof id === 'string' && id ? `${spec[0]}:${id}` : null
}
