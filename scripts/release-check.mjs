import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const steps = [
  [process.execPath, [npmCli, 'run', 'build'], 'build + typecheck'],
  [process.execPath, [npmCli, 'test'], 'test suite'],
  [process.execPath, ['scripts/verify-mcp.mjs'], 'MCP handshake'],
  [process.execPath, ['scripts/verify-projects.mjs'], 'project corpus'],
  [process.execPath, ['scripts/verify-package.mjs'], 'npm tarball install'],
]

for (const [command, args, label] of steps) {
  console.log(`\n[release] ${label}`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: false })
  if (result.error) {
    console.error(`[release] ${label} could not start: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`[release] ${label} failed with exit code ${result.status ?? 'unknown'}`)
    process.exit(result.status ?? 1)
  }
}

console.log('\nRELEASE CHECK OK')
