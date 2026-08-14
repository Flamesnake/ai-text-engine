import { beforeEach, describe, expect, it } from 'vitest'
import { observeToolCall, resetObservability, snapshotObservability } from './observability.js'

describe('MCP 成本观测', () => {
  beforeEach(() => resetObservability())

  it('只记录工具、体量、耗时与资源 id，不保存剧情正文', async () => {
    const result = await observeToolCall(
      'story_upsert_node',
      { title: '测试', node: { id: 'n1', text: '不应进入观测摘要', choices: [] } },
      async () => ({ ok: true, message: '同样不记录' }),
    )
    expect(result).toMatchObject({ ok: true })
    const report = snapshotObservability()
    expect(report.totals.calls).toBe(1)
    expect(report.tools[0]).toMatchObject({ tool: 'story_upsert_node', calls: 1 })
    expect(report.resources).toContainEqual({ resource: 'node:n1', writes: 1, overwrites: 0 })
    expect(JSON.stringify(report)).not.toContain('不应进入观测摘要')
  })

  it('统计同一资源重复覆盖、失败调用和可清零窗口', async () => {
    await observeToolCall('story_upsert_node', { title: '测试', node: { id: 'n1' } }, async () => ({ ok: true }))
    await observeToolCall('story_upsert_node', { title: '测试', node: { id: 'n1' } }, async () => ({ ok: true }))
    await expect(observeToolCall('story_get', { title: '测试' }, async () => { throw new Error('x') })).rejects.toThrow('x')
    const report = snapshotObservability()
    expect(report.totals).toMatchObject({ calls: 3, failures: 1, fullReads: 1, repeatedOverwrites: 1 })
    resetObservability()
    expect(snapshotObservability().totals.calls).toBe(0)
  })
})
