/**
 * MCP 工具实现聚合（P2-3：按域拆分到 handlers/{nodes,characters,evidence,meta}）。
 * 本文件只做 re-export 与注册表聚合；实现、描述、schema 与 handler 同址于各域文件。
 * 保持既有导出名不变（脚本/测试仍可 import * as handlers 直调）。
 */
export * from './handlers/nodes.js'
export * from './handlers/characters.js'
export * from './handlers/evidence.js'
export * from './handlers/meta.js'
import { NODE_TOOLS } from './handlers/nodes.js'
import { CHARACTER_TOOLS } from './handlers/characters.js'
import { EVIDENCE_TOOLS } from './handlers/evidence.js'
import { META_TOOLS } from './handlers/meta.js'
import type { ToolDef } from './tool-def.js'

/** MCP 服务器注册表：全部工具（描述 + schema + handler 三元组）。 */
export const ALL_TOOLS: ToolDef[] = [
  ...NODE_TOOLS,
  ...CHARACTER_TOOLS,
  ...EVIDENCE_TOOLS,
  ...META_TOOLS,
]

/** 兼容旧引用：名称 → 实现（server 注册表已改走 ALL_TOOLS）。 */
export const tools: Record<string, (args: any) => Promise<unknown>> = Object.fromEntries(
  ALL_TOOLS.map((tool) => [tool.name, tool.handler]),
)