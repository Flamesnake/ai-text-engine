import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ALL_TOOLS } from './handlers.js'
import { observeToolCall } from './observability.js'
import { serializeResult } from './serialize.js'
import { ENGINE_VERSION } from '../version.js'

/**
 * TaleSpindle MCP 服务器（stdio）。
 * 让 AI 客户端通过工具操作引擎：创建项目、编辑节点、校验、导出单文件 HTML。
 *
 * 启动：npm run mcp （或 node dist/mcp/server.js）
 * 注册：在 .mcp.json 的 mcpServers 中引用本服务器。
 *
 * 工具注册表（P2-3）：描述 + schema + handler 三元组同址于 handlers/{nodes,characters,evidence,meta}，
 * 本文件只做注册循环与统一包装。
 */

const server = new McpServer({
  name: 'talespindle',
  version: ENGINE_VERSION,
})

/** 统一包装：结果按阈值序列化（小结果 pretty / 大结果紧凑）；异常转为 isError 响应 */
function wrap(tool: string, handler: (args: any) => Promise<unknown>, observe = true) {
  return async (args: any) => {
    try {
      const result = observe
        ? await observeToolCall(tool, args, () => handler(args))
        : await handler(args)
      return { content: [{ type: 'text' as const, text: serializeResult(result) }] }
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `错误：${err instanceof Error ? err.message : String(err)}` }],
      }
    }
  }
}

/* ------------------------------ 工具注册（注册表循环） ------------------------------ */

for (const tool of ALL_TOOLS) {
  server.tool(
    tool.name,
    tool.description,
    tool.schema,
    wrap(tool.name, (args) => tool.handler(args), tool.observe ?? true),
  )
}

/* ------------------------------ 启动 ------------------------------ */

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('TaleSpindle MCP server 启动失败:', err)
  process.exit(1)
})