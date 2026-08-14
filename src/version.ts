import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageJson = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')

export const ENGINE_VERSION: string = (() => {
  try {
    const parsed = JSON.parse(readFileSync(packageJson, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
})()
