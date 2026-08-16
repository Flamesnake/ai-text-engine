#!/usr/bin/env node
import path from 'node:path'
import {
  doctor,
  exportProject,
  initHome,
  installSkill,
  validateProject,
  type SkillClient,
} from './cli/commands.js'
import { setProjectsRoot } from './mcp/projects.js'
import { ENGINE_VERSION } from './version.js'

const HELP = `talespindle <command> [options]

Commands:
  doctor                         检查预构建运行时、MCP、Skill 与作品目录
  init [--home <dir>]            创建安全的作品数据目录
  mcp [--home <dir>]             启动 stdio MCP 服务器
  install-skill [options]        安装配套 Skill
  export <title> [--out <dir>]   校验并导出单文件 HTML（薄封装 story_export）
  validate <title> [--compact]   校验剧情完整性（薄封装 story_validate）
  version                        显示版本（毫秒级，不跑检查）

install-skill options:
  --client agents|codex|claude   默认 agents
  --target <skills-dir>          自定义技能根目录
  --force                        覆盖已安装副本

Environment:
  TALESPINDLE_HOME               数据根目录；作品写入其 projects/ 子目录
  AI_TEXT_ENGINE_HOME            旧名称，仍兼容
`

async function main(argv = process.argv.slice(2)): Promise<number> {
  const command = argv[0] ?? 'help'
  const home = optionValue(argv, '--home')

  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP)
    return 0
  }
  if (command === 'version' || command === '--version' || command === '-v') {
    process.stdout.write(`${ENGINE_VERSION}\n`)
    return 0
  }
  if (command === 'export') {
    const title = argv[1]
    if (!title) throw new Error('export 需要 <title> 参数（talespindle export <title> [--out <dir>]）')
    const result = (await exportProject({ title, outputDir: optionValue(argv, '--out') })) as {
      ok?: boolean
      outputPath?: string
      sizeBytes?: number
      message?: string
      runtimeWarning?: string
    }
    if (!result.ok) {
      process.stderr.write(`导出失败：${result.message ?? '剧情校验未通过'}\n`)
      return 1
    }
    process.stdout.write(`已导出：${result.outputPath}（${result.sizeBytes} 字节）\n`)
    if (result.runtimeWarning) process.stderr.write(`警告：${result.runtimeWarning}\n`)
    return 0
  }
  if (command === 'validate') {
    const title = argv[1]
    if (!title) throw new Error('validate 需要 <title> 参数（talespindle validate <title> [--compact]）')
    const result = (await validateProject({ title, compact: argv.includes('--compact') })) as {
      title: string
      validatePass?: boolean
      problems?: unknown[]
      nodeCount?: number
      endingCount?: number
    }
    if (result.validatePass) {
      process.stdout.write(`✓ ${result.title} 校验通过（${result.nodeCount} 节点 / ${result.endingCount} 结局）\n`)
      return 0
    }
    process.stderr.write(`✗ ${result.title} 校验未通过：${result.problems?.length ?? 0} 处问题\n`)
    process.stderr.write(`${JSON.stringify(result.problems, null, 2)}\n`)
    return 1
  }
  if (command === 'doctor') {
    const result = await doctor({ home })
    process.stdout.write(`TaleSpindle ${result.version} · Node ${result.node}\n`)
    for (const check of result.checks) {
      process.stdout.write(`${check.ok ? 'OK' : 'FAIL'} ${check.name}${check.path ? `: ${check.path}` : ''}${check.message ? ` (${check.message})` : ''}\n`)
    }
    return result.ok ? 0 : 1
  }
  if (command === 'init') {
    const result = await initHome(home)
    process.stdout.write(`作品目录已准备：${result.projectsRoot}\n`)
    return 0
  }
  if (command === 'install-skill') {
    const client = (optionValue(argv, '--client') ?? 'agents') as SkillClient
    if (!['agents', 'codex', 'claude'].includes(client)) {
      throw new Error(`不支持的 Skill 客户端：${client}`)
    }
    const result = await installSkill({
      client,
      target: optionValue(argv, '--target'),
      force: argv.includes('--force'),
    })
    process.stdout.write(`Skill 已安装（${result.client}）：${result.destination}\n`)
    return 0
  }
  if (command === 'mcp') {
    if (home) setProjectsRoot(path.join(path.resolve(home), 'projects'))
    await import('./mcp/server.js')
    return 0
  }

  process.stderr.write(`未知命令：${command}\n\n${HELP}`)
  return 1
}

function optionValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index < 0) return undefined
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} 缺少参数`)
  return value
}

main().then((code) => {
  process.exitCode = code
}).catch((error) => {
  process.stderr.write(`talespindle: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})