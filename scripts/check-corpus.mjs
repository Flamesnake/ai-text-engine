import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStory } from '../dist/core/schema.js'
import { validate, validateExperience } from '../dist/core/validate.js'
import { evaluateStory } from '../dist/core/evaluate.js'
import { walkAllEndings } from '../dist/core/walk.js'

/**
 * 全语料健康仪表盘：对每个故事项目跑 静态校验 → 体验提示 → 路径探索 → 作品评估，
 * 输出一张可横向比较的表格。只对“结构损坏 / 结局不可达”返回非零，体验类问题仅报告。
 *
 * 用法:
 *   node scripts/check-corpus.mjs [root1 root2 ...] [--max-states=N] [--witness-max-states=N]
 *
 * 默认扫描仓库 projects/；额外目录用空格分隔传入（例如 E:/GAMER/VOID/projects）。
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)

function parseOption(name, fallback) {
  const prefix = `--${name}=`
  const arg = args.find((item) => item.startsWith(prefix))
  const value = arg ? Number(arg.slice(prefix.length)) : fallback
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`${name} 必须是正整数`)
    process.exit(2)
  }
  return value
}

const maxStates = parseOption('max-states', 60000)
const witnessMaxStates = parseOption('witness-max-states', 20000)
const roots = args.filter((item) => !item.startsWith('--'))
const corpusRoots = roots.length > 0
  ? roots.map((item) => path.resolve(item))
  : [path.join(repoRoot, 'projects')]

/** 直接子目录里的 story.json，按目录名排序（目录名通常接近作品标题）。 */
async function collectStories(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

function pct(value) {
  return `${(value * 100).toFixed(0)}%`
}

function pad(text, width) {
  const str = String(text)
  const visible = [...str].length
  return str + ' '.repeat(Math.max(0, width - visible))
}

async function main() {
  const rows = []
  const structuralFailures = []
  let checked = 0

  for (const rootDir of corpusRoots) {
    let stories
    try {
      stories = await collectStories(rootDir)
    } catch {
      structuralFailures.push(`语料目录不存在或不可读：${rootDir}`)
      continue
    }
    const rootLabel = rootDir === path.join(repoRoot, 'projects')
      ? 'repo'
      : path.basename(path.dirname(rootDir))

    for (const title of stories) {
      const storyPath = path.join(rootDir, title, 'story.json')
      let source
      try {
        source = await readFile(storyPath, 'utf8')
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'ENOENT') continue
        structuralFailures.push(`${rootLabel}/${title}: 无法读取 story.json (${error instanceof Error ? error.message : String(error)})`)
        continue
      }

      let story
      try {
        story = parseStory(source.replace(/^\uFEFF/u, ''))
      } catch (error) {
        structuralFailures.push(`${rootLabel}/${title}: 解析失败 (${error instanceof Error ? error.message : String(error)})`)
        continue
      }

      const problems = validate(story)
      const experienceWarnings = validateExperience(story)
      const walk = walkAllEndings(story, { maxStates, witnessMaxStates, diagnostics: false })
      const evaluation = evaluateStory(story, { walk })

      const nodes = Object.keys(story.nodes).length
      const endings = Object.keys(story.endings).length
      const findings = evaluation.findings ?? []
      const warningFindings = findings.filter((finding) => finding.severity === 'warning').length
      const infoFindings = findings.filter((finding) => finding.severity === 'info').length
      const softLocks = walk.failures?.witnesses?.filter((item) => item.kind === 'soft_lock').length ?? 0
      const invalidTerminals = walk.failures?.witnesses?.filter((item) => item.kind === 'invalid_terminal').length ?? 0
      const siteKind = story.meta.site?.kind ?? '-'

      rows.push({
        root: rootLabel,
        title,
        nodes,
        endings,
        problems: problems.length,
        expWarnings: experienceWarnings.length,
        warnFindings: warningFindings,
        infoFindings,
        allEndingsProven: walk.reachability?.allEndingsProven ?? false,
        unproven: walk.reachability?.unprovenEndings?.length ?? 0,
        softLocks,
        invalidTerminals,
        coverageComplete: walk.coverage?.complete ?? false,
        budgetUsed: walk.budget?.used ?? 0,
        budgetLimit: walk.budget?.limit ?? maxStates,
        siteKind,
      })

      checked += 1
      if (problems.length > 0) {
        structuralFailures.push(`${rootLabel}/${title}: ${problems.length} 个静态问题\n  - ${problems.slice(0, 5).join('\n  - ')}`)
      }
      if (!walk.reachability?.allEndingsProven) {
        structuralFailures.push(`${rootLabel}/${title}: 结局未全部证明可达（未证明 ${walk.reachability?.unprovenEndings?.join(', ') ?? '?'}）`)
      }
    }
  }

  if (checked === 0) {
    structuralFailures.push('没有找到可检查的 story.json')
  }

  const headers = ['作品', '语料', '节点', '结局', '静态', '体验', '评警', '评讯', '可达', '软锁', '覆盖', '预算', '壳']
  const widths = [24, 8, 5, 5, 5, 5, 5, 5, 5, 5, 5, 12, 8]
  const line = headers.map((header, index) => pad(header, widths[index])).join(' ')
  console.log(line)
  console.log('-'.repeat([...line].length))

  for (const row of rows) {
    const cells = [
      row.title,
      row.root,
      row.nodes,
      row.endings,
      row.problems,
      row.expWarnings,
      row.warnFindings,
      row.infoFindings,
      row.allEndingsProven ? 'OK' : 'NO',
      row.softLocks,
      row.coverageComplete ? 'OK' : '截断',
      `${row.budgetUsed}/${row.budgetLimit}`,
      row.siteKind,
    ]
    console.log(cells.map((cell, index) => pad(cell, widths[index])).join(' '))
  }

  console.log(`\nCORPUS HEALTH CHECKED ${checked} STORIES (maxStates=${maxStates}, witnessMaxStates=${witnessMaxStates})`)

  if (structuralFailures.length > 0) {
    console.error(`\nCORPUS HEALTH FAILED\n${structuralFailures.join('\n')}`)
    process.exitCode = 1
  } else {
    console.log('CORPUS HEALTH OK')
  }
}

await main()
