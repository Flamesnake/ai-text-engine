/**
 * TaleSpindle 本地 MCP stdio 客户端（薄封装，不复制核心逻辑）。
 * 按 MCP stdio 协议（换行分隔 JSON-RPC）与 `talespindle mcp` 服务器通信。
 * 不引入 @modelcontextprotocol/sdk：插件保持零额外运行时依赖。
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface TalespindleInstallInfo {
  cliPath: string | null
  version: string | null
  error?: string
}

/** 定位 talespindle CLI：环境变量 → npm 全局 → 开发仓库兄弟目录。 */
export async function resolveCliPath(): Promise<TalespindleInstallInfo> {
  const envPath = process.env.TALESPINDLE_CLI?.trim()
  if (envPath) {
    if (existsSync(envPath)) return { cliPath: envPath, version: readVersion(envPath) }
    return { cliPath: null, version: null, error: `TALESPINDLE_CLI 指向的文件不存在：${envPath}` }
  }

  // npm 全局安装（npm root -g 下 @marianaj/talespindle/dist/cli.js）
  try {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const root = spawnSync(npm, ['root', '-g'], { encoding: 'utf8', timeout: 15_000 })
    const candidate = path.join((root.stdout ?? '').trim(), '@marianaj', 'talespindle', 'dist', 'cli.js')
    if (root.status === 0 && existsSync(candidate)) {
      return { cliPath: candidate, version: readVersion(candidate) }
    }
  } catch {
    /* 全局查找失败继续回退 */
  }

  // 开发回退：插件位于主仓库 plugins/dsh-talespindle/ 内，直接指向仓库根的 dist/cli.js
  const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const sibling = path.resolve(here, '..', '..', 'dist', 'cli.js')
  if (existsSync(sibling)) return { cliPath: sibling, version: readVersion(sibling) }

  return {
    cliPath: null,
    version: null,
    error: '未找到 talespindle CLI。请先安装：npm i -g @marianaj/talespindle，或用 TALESPINDLE_CLI 指定路径',
  }
}

function readVersion(cliPath: string): string | null {
  try {
    const result = spawnSync(process.execPath, [cliPath, 'version'], { encoding: 'utf8', timeout: 15_000 })
    return result.status === 0 ? (result.stdout ?? '').trim() || null : null
  } catch {
    return null
  }
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (reason: Error) => void
}

export class TalespindleClient {
  private readonly proc: ChildProcess
  private buffer = ''
  private readonly pending = new Map<number, PendingRequest>()
  private nextId = 1
  private stderrTail = ''
  private closed = false

  constructor(cliPath: string) {
    this.proc = spawn(process.execPath, [cliPath, 'mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.proc.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8')
      let newline: number
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).trim()
        this.buffer = this.buffer.slice(newline + 1)
        if (line) this.handleLine(line)
      }
    })
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString('utf8')).slice(-2000)
    })
    this.proc.on('exit', () => {
      const err = new Error(`talespindle MCP 进程已退出：${this.stderrTail.trim() || '无 stderr 输出'}`)
      for (const request of this.pending.values()) request.reject(err)
      this.pending.clear()
    })
  }

  private handleLine(line: string): void {
    let message: any
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (message.id !== undefined) {
      const request = this.pending.get(message.id)
      if (request) {
        this.pending.delete(message.id)
        if (message.error) request.reject(new Error(`MCP 错误：${message.error.message ?? JSON.stringify(message.error)}`))
        else request.resolve(message)
      }
    }
  }

  private rpc(method: string, params?: unknown): Promise<any> {
    if (this.closed) return Promise.reject(new Error('talespindle MCP 会话已关闭'))
    const id = this.nextId++
    const promise = new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return promise
  }

  /** initialize + notifications/initialized 握手。 */
  async initialize(): Promise<void> {
    await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'dsh-talespindle', version: '0.0.1' },
    })
    this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  }

  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    const response = await this.rpc('tools/list', {})
    return response?.result?.tools ?? []
  }

  /** 透传 story_* 工具调用；MCP isError 结果转为可读的失败值。 */
  async callTool(name: string, args: Record<string, unknown>): Promise<any> {
    const response = await this.rpc('tools/call', { name, arguments: args })
    if (response?.result?.isError) {
      const text = response.result.content?.map((c: any) => c.text ?? '').join('') ?? '未知错误'
      return { ok: false, error: text }
    }
    const text = response?.result?.content?.map((c: any) => c.text ?? '').join('') ?? ''
    try {
      return { ok: true, data: JSON.parse(text) }
    } catch {
      return { ok: true, data: { raw: text } }
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.proc.kill()
  }
}