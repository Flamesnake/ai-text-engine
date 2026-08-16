import { Buffer } from 'node:buffer'

/**
 * MCP 结果序列化：小结果保持 pretty（可读），大结果紧凑序列化（省 token/带宽）。
 * 项目自身强调 token 成本（compact 模式、observability 字节统计），
 * 大结果（story_get / walk / evaluate）pretty 化会膨胀 15–30%。
 */
export const PRETTY_LIMIT_BYTES = 2048

/** 结果 JSON 文本：≤ PRETTY_LIMIT_BYTES 时 pretty（2 空格缩进），否则紧凑。 */
export function serializeResult(result: unknown): string {
  const pretty = JSON.stringify(result, null, 2)
  return Buffer.byteLength(pretty, 'utf8') <= PRETTY_LIMIT_BYTES ? pretty : JSON.stringify(result)
}