import { describe, expect, it } from 'vitest'
import { PRETTY_LIMIT_BYTES, serializeResult } from './serialize.js'

describe('MCP 结果序列化（P1-1）', () => {
  it('小结果保持 pretty（可读）', () => {
    const text = serializeResult({ ok: true, nodeCount: 2 })
    expect(text).toContain('\n  ') // 2 空格缩进
    expect(JSON.parse(text)).toEqual({ ok: true, nodeCount: 2 })
  })

  it('超过阈值的大结果紧凑序列化（省 token）', () => {
    const big = {
      title: '大作品',
      nodes: Object.fromEntries(
        Array.from({ length: 60 }, (_, i) => [
          `node_${i}`,
          { id: `node_${i}`, text: '这是一段用于撑大结果的正文文本。'.repeat(4), choices: [] },
        ]),
      ),
    }
    const pretty = JSON.stringify(big, null, 2)
    expect(Buffer.byteLength(pretty, 'utf8')).toBeGreaterThan(PRETTY_LIMIT_BYTES)

    const compact = serializeResult(big)
    expect(compact).not.toContain('\n  ')
    expect(Buffer.byteLength(compact, 'utf8')).toBeLessThan(Buffer.byteLength(pretty, 'utf8'))
    // 语义不变：解析后等价
    expect(JSON.parse(compact)).toEqual(big)
  })

  it('恰好等于阈值时仍 pretty', () => {
    const result = { a: 'x'.repeat(PRETTY_LIMIT_BYTES - 20) }
    const text = serializeResult(result)
    expect(text).toContain('\n  ')
  })
})