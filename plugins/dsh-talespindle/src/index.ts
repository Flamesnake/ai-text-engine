/**
 * @dsh-external/dsh-talespindle — TaleSpindle 本地 MCP 薄封装（工具包形态）。
 *
 * 边界（见 ai-text-engine docs/dev/plugin-readiness.md）：
 * 插件只负责安装检查、会话管理、工具透传与导出入口；
 * 剧情模型、校验、walk、运行时与导出仍是宿主无关核心，不在此复制。
 *
 * 资源注册全部挂 ctx.effect（热重载/卸载自动清理）。
 */
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'
import { resolveCliPath, TalespindleClient, type TalespindleInstallInfo } from './mcp-client.js'

export const name = '@dsh-external/dsh-talespindle'
export const inject = ['tools', 'systemPrompt']

export interface Config {
  /** 会话空闲自动关闭分钟数（0 = 不自动关闭） */
  idleMinutes: number
}

export const Config = z.object({
  idleMinutes: z.number().default(30),
})

/** 模块级会话缓存：一次 DSH 进程内多个会话共享同一 MCP 子进程。 */
let activeClient: TalespindleClient | null = null
let activeCliPath: string | null = null

async function getClient(): Promise<TalespindleClient> {
  if (activeClient) return activeClient
  const info = await resolveCliPath()
  if (!info.cliPath) throw new Error(info.error ?? '未找到 talespindle CLI')
  const client = new TalespindleClient(info.cliPath)
  await client.initialize()
  await client.listTools() // 启动期握手，尽早暴露配置错误
  activeClient = client
  activeCliPath = info.cliPath
  return client
}

function disposeClient(): void {
  activeClient?.close()
  activeClient = null
  activeCliPath = null
}

/** 统一注册 + ctx.effect 生命周期（fiber dispose 自动注销）。 */
function registerTool(
  ctx: Context,
  toolName: string,
  description: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters: any,
  execute: (args: any) => Promise<unknown>,
): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: toolName,
    description,
    parameters,
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args: any) => JSON.stringify(await execute(args), null, 2),
  })), `${name}: ${toolName}`)
}

export function apply(ctx: Context, config: Config): void {
  // 核心工具：安装状态（首轮锚定保留项）
  registerTool(ctx, 'talespindle_status', 'TaleSpindle 引擎安装状态：CLI 路径、版本、可用 story_* 工具数（未安装时给出安装指引）', {}, async () => {
    const info: TalespindleInstallInfo = await resolveCliPath()
    const result: Record<string, unknown> = {
      installed: Boolean(info.cliPath),
      cliPath: info.cliPath,
      version: info.version,
    }
    if (info.error) result.error = info.error
    if (info.cliPath && activeClient) {
      try {
        const tools = await activeClient.listTools()
        result.tools = tools.map((t) => t.name)
        result.sessionActive = true
      } catch (error) {
        result.sessionActive = false
        result.sessionError = error instanceof Error ? error.message : String(error)
      }
    } else {
      result.sessionActive = false
    }
    return result
  })

  // 确保 MCP 会话就绪
  registerTool(ctx, 'talespindle_ensure', '确保 TaleSpindle 本地 MCP 会话就绪，返回服务器信息与 story_* 工具清单', {}, async () => {
    const client = await getClient()
    const tools = await client.listTools()
    return {
      ok: true,
      cliPath: activeCliPath,
      tools: tools.map((t) => t.name),
      toolCount: tools.length,
    }
  })

  // 通用透传
  registerTool(ctx, 'talespindle_call', '透传调用 TaleSpindle MCP 工具（story_new/story_get/story_upsert_node/story_validate/story_walk 等任意 story_*），args 即该工具的参数对象', {
    tool: { type: 'string', required: true, description: 'story_* 工具名，如 story_get' },
    args: { type: 'object', required: true, additionalProperties: true, description: '该工具的参数对象，如 {"title":"项目名"}' },
  }, async (args: { tool: string; args: Record<string, unknown> }) => {
    const client = await getClient()
    return client.callTool(args.tool, args.args ?? {})
  })

  // 项目列表快捷
  registerTool(ctx, 'talespindle_projects', '列出本地 TaleSpindle 项目（名称/节点/结局数）', {}, async () => {
    const client = await getClient()
    return client.callTool('story_list', {})
  })

  // 导出快捷
  registerTool(ctx, 'talespindle_export', '校验并导出指定 TaleSpindle 项目为单文件 HTML，返回 outputPath 与大小', {
    title: { type: 'string', required: true, description: '项目标题' },
  }, async (args: { title: string }) => {
    const client = await getClient()
    return client.callTool('story_export', { title: args.title })
  })

  // 卸载/重载时回收 MCP 子进程
  ctx.effect(() => {
    const timer = config.idleMinutes > 0
      ? setInterval(() => {
          disposeClient()
        }, config.idleMinutes * 60_000)
      : null
    return () => {
      if (timer) clearInterval(timer)
      disposeClient()
    }
  }, `${name}: lifecycle`)

  // ── 高性能引导：首轮锚定（工具面 ≥5 个，只露核心工具）──────────
  // 会话无任何持久化 tool/call 前只保留 talespindle_status；首个工具调用后恢复全部。
  ctx.on('system-prompt/assemble', async (_assembly: unknown, context: any, next: () => Promise<any>) => {
    const assembled = await next()
    const agent = context.agent
    if (!agent || agent.session.events.some((e: any) => e.type === 'tool/call')) return assembled
    const MINE = new Set(['talespindle_status', 'talespindle_ensure', 'talespindle_call', 'talespindle_projects', 'talespindle_export'])
    const CORE = 'talespindle_status'
    return { ...assembled, tools: assembled.tools.filter((t: any) => !MINE.has(t.name) || t.name === CORE) }
  })
}