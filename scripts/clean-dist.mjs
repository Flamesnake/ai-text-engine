import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.resolve(root, 'dist')
if (path.dirname(dist) !== root || path.basename(dist) !== 'dist') {
  throw new Error(`refusing to clean unexpected path: ${dist}`)
}
await rm(dist, { recursive: true, force: true })
