import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ENGINE_VERSION } from './version.js'

describe('package version', () => {
  it('MCP/CLI 使用 package.json 的版本真相源', () => {
    const pkg = JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string }
    expect(ENGINE_VERSION).toBe(pkg.version)
  })
})
