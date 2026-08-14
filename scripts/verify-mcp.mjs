// MCP stdio 握手验证：initialize → notifications/initialized → tools/list
// 用法：node scripts/verify-mcp.mjs
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverPath = path.join(root, 'dist/mcp/server.js')

const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] })

let buffer = ''
const responses = []
child.stderr.on('data', (c) => process.stderr.write(`[server] ${c}`))
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    try {
      responses.push(JSON.parse(line))
    } catch {
      // ignore partial
    }
  }
})

const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n')

send({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'verify-mcp', version: '0.0.1' },
  },
})

setTimeout(() => {
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
}, 400)

setTimeout(() => {
  const initResp = responses.find((r) => r.id === 1)
  const toolsResp = responses.find((r) => r.id === 2)
  const tools = toolsResp?.result?.tools ?? []
  const serverInfo = initResp?.result?.serverInfo
  console.log('serverInfo:', JSON.stringify(serverInfo))
  console.log('tool count:', tools.length)
  console.log('tools:', tools.map((t) => t.name).join(', '))
  const ok = tools.length >= 10 && serverInfo?.name === 'talespindle'
  console.log(ok ? 'VERIFY OK' : 'VERIFY FAIL')
  child.kill()
  process.exit(ok ? 0 : 1)
}, 1600)
