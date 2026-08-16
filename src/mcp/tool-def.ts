import type { ZodTypeAny } from 'zod'

/** MCP 工具注册三元组：描述 + schema + handler 同址（P2-3），server.ts 只做注册循环。 */
export interface ToolDef {
  name: string
  description: string
  /** zod 参数 schema（server.tool 的第三个参数：Record<string, ZodTypeAny>） */
  schema: Record<string, ZodTypeAny>
  /** MCP 传输边界：运行时参数未经 TS 校验，由 zod schema 兜底（域内函数仍保持强类型）。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<unknown>
  /** 是否计入 observability（story_observability 相关工具为 false） */
  observe?: boolean
}