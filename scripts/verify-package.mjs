import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temp = await mkdtemp(path.join(os.tmpdir(), 'talespindle-package-'))
const packDir = path.join(temp, 'pack')
const installDir = path.join(temp, 'install')
const cacheDir = path.join(root, '_scratch', 'npm-cache')
const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')

await mkdir(packDir, { recursive: true })
await mkdir(installDir, { recursive: true })
const packResult = runNpm(
  ['pack', root, '--json', '--ignore-scripts', '--pack-destination', packDir, '--cache', cacheDir],
  { capture: true },
)
const packed = JSON.parse(packResult.stdout)[0]
const files = packed.files.map((file) => file.path)
const required = ['dist/cli.js', 'dist/mcp/server.js', 'dist/export/runtime.bundle.js', 'skill/SKILL.md', 'docs/world-state.md', 'README.md', 'LICENSE']
const forbidden = files.filter((file) =>
  file.startsWith('projects/') || file.startsWith('src/') || file.startsWith('_scratch/') ||
  file.startsWith('.codex/') || file.startsWith('.reasonix/') || file.includes('.test.'))
for (const file of required) {
  if (!files.includes(file)) throw new Error(`package missing required file: ${file}`)
}
if (forbidden.length > 0) throw new Error(`package contains forbidden files: ${forbidden.join(', ')}`)

const tarball = path.join(packDir, packed.filename)
runNpm(['init', '-y', '--cache', cacheDir], { cwd: installDir })
runNpm(['install', tarball, '--ignore-scripts', '--omit=dev', '--cache', cacheDir], { cwd: installDir })

const installedRoot = path.join(installDir, 'node_modules', packed.name)
const cliPath = path.join(installedRoot, 'dist', 'cli.js')
const dataHome = path.join(temp, 'data')
const publicApi = await import(pathToFileURL(path.join(installedRoot, 'dist', 'index.js')).href)
const mcpApi = await import(pathToFileURL(path.join(installedRoot, 'dist', 'mcp-api.js')).href)
if (typeof publicApi.evaluateStory !== 'function' || typeof publicApi.exportToHtml !== 'function' ||
    typeof mcpApi.newProject !== 'function' || typeof mcpApi.setProjectsRoot !== 'function') {
  throw new Error('installed public API exports are incomplete')
}
const doctor = spawnSync(process.execPath, [cliPath, 'doctor', '--home', dataHome], {
  cwd: installDir, encoding: 'utf8', env: { ...process.env, TALESPINDLE_HOME: dataHome },
})
if (doctor.status !== 0 || !doctor.stdout.includes('OK mcp-server') || !doctor.stdout.includes('OK runtime-bundle')) {
  throw new Error(`installed doctor failed:\n${doctor.stdout}\n${doctor.stderr}`)
}
const defaultDataBase = path.join(temp, 'default-data')
const defaultDoctor = spawnSync(process.execPath, [cliPath, 'doctor'], {
  cwd: installDir,
  encoding: 'utf8',
  env: {
    ...process.env,
    TALESPINDLE_HOME: '',
    AI_TEXT_ENGINE_HOME: '',
    LOCALAPPDATA: defaultDataBase,
    XDG_DATA_HOME: defaultDataBase,
  },
})
if (defaultDoctor.status !== 0 || !defaultDoctor.stdout.includes(defaultDataBase) || defaultDoctor.stdout.includes(path.join(installedRoot, 'projects'))) {
  throw new Error(`installed default data isolation failed:\n${defaultDoctor.stdout}\n${defaultDoctor.stderr}`)
}

const skillsRoot = path.join(temp, 'skills')
const skillInstall = spawnSync(process.execPath, [cliPath, 'install-skill', '--target', skillsRoot], {
  cwd: installDir, encoding: 'utf8',
})
if (skillInstall.status !== 0) throw new Error(`installed Skill command failed:\n${skillInstall.stderr}`)
await accessFile(path.join(skillsRoot, 'talespindle-author', 'SKILL.md'))
await verifyInstalledMcp(cliPath, installDir, dataHome)

const { exportToHtml } = await import(pathToFileURL(path.join(installedRoot, 'dist', 'export', 'exporter.js')).href)
const outputDir = path.join(temp, 'export')
const exported = await exportToHtml({
  meta: { title: 'package-smoke' }, start: 'end',
  endings: { e: { id: 'e', title: '完成', kind: 'good' } },
  nodes: { end: { id: 'end', text: '安装包可以导出。', choices: [], ending: { id: 'e', title: '完成', kind: 'good' } } },
}, { outputDir })
const html = await readFile(exported.outputPath, 'utf8')
if (!html.includes('安装包可以导出。') || !html.includes('TextAdventure')) {
  throw new Error('installed exporter did not produce a playable self-contained HTML')
}

console.log(`PACKAGE VERIFY OK (${files.length} files, ${packed.size} bytes)`)
console.log(`doctor home: ${dataHome}`)
console.log(`export: ${exported.outputPath}`)

async function verifyInstalledMcp(cliPath, cwd, dataHome) {
  const child = (await import('node:child_process')).spawn(
    process.execPath, [cliPath, 'mcp', '--home', dataHome],
    { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, TALESPINDLE_HOME: dataHome } },
  )
  let buffer = ''
  const responses = []
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) responses.push(JSON.parse(line))
    }
  })
  const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`)
  send({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'package-smoke', version: '1' } },
  })
  await delay(250)
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  await delay(700)
  child.kill()
  const tools = responses.find((response) => response.id === 2)?.result?.tools ?? []
  if (tools.length < 20 || !tools.some((tool) => tool.name === 'story_export')) {
    throw new Error(`installed MCP handshake failed; received ${tools.length} tools`)
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function accessFile(file) {
  await readFile(file, 'utf8')
}

function runNpm(args, options = {}) {
  const cwd = options.cwd ?? root
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd, encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit', maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed (${result.status})\n${result.stderr ?? ''}`)
  return result
}
