// 端到端演示：通过 MCP stdio 协议模拟 AI 操作引擎制作一个完整小游戏
// 用法：node scripts/demo.mjs
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const child = spawn(process.execPath, [path.join(root, 'dist/mcp/server.js')], {
  stdio: ['pipe', 'pipe', 'pipe'],
})
child.stderr.on('data', (c) => process.stderr.write(`[server] ${c}`))

let buffer = ''
let nextId = 0
const pending = new Map()

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  let idx
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  }
})

const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n')

async function init() {
  await new Promise((resolve) => {
    const id = ++nextId
    pending.set(id, { resolve, reject: resolve })
    send({
      jsonrpc: '2.0',
      id,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'demo', version: '0.0.1' } },
    })
  })
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
}

function call(name, args) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
  })
}

async function tool(name, args) {
  const res = await call(name, args)
  const text = res?.content?.[0]?.text ?? JSON.stringify(res)
  const parsed = JSON.parse(text)
  console.log(`\n=== ${name} ===`)
  console.log(parsed.ok === undefined ? JSON.stringify(parsed).slice(0, 120) : `ok=${parsed.ok}`)
  return parsed
}

await init()

// 1. 创建项目
await tool('story_new', { title: '迷雾车站', subtitle: '你错过了末班车。', author: 'ai-demo' })

// 1.5 清理骨架自带的示例节点与结局
await tool('story_delete_node', { title: '迷雾车站', nodeId: 'end', force: true })
await tool('story_delete_ending', { title: '迷雾车站', endingId: 'e_end' })

// 1.6 风格与 HUD：赛博霓虹主题 + 心境/天数统计条
await tool('story_set_meta', {
  title: '迷雾车站',
  theme: 'cyber',
  hud: [
    { var: 'mood', label: '心境', max: 3 },
    { var: '#day', label: '第几天', max: 7 },
  ],
})

// 1.7 成就系统
const achievements = [
  {
    id: 'a_umbrella',
    title: '拾伞者',
    description: '在长椅角落拾起那把旧伞',
    icon: '☂️',
    when: { op: 'has', var: '旧伞' },
  },
  {
    id: 'a_platform',
    title: '雾中行者',
    description: '走到月台尽头',
    icon: '🌫️',
    when: { op: 'eq', var: '#visited', value: 'platform' },
  },
  {
    id: 'a_secret',
    title: '旧车站真相',
    description: '发现三年前停运的真相',
    icon: '🕯️',
    hidden: true,
    when: { op: 'eq', var: '#ending', value: 'e_secret' },
  },
]
for (const achievement of achievements) {
  await tool('story_upsert_achievement', { title: '迷雾车站', achievement })
}

// 1.8 线索/文档系统（规则怪谈核心载体）
const documents = [
  {
    id: 'd_schedule',
    title: '旧车站时刻表',
    kind: 'rules',
    text: '末班车：23:00 发车\n三年前停运\n如遇雾天，请勿在站台逗留',
  },
  {
    id: 'd_handbook',
    title: '检票员手记',
    kind: 'note',
    text: '「别信广播。雾里的人不是乘客。」',
  },
]
for (const document of documents) {
  await tool('story_upsert_document', { title: '迷雾车站', document })
}

// 2. 构建剧情节点
const nodes = [
  {
    id: 'start',
    text: '',
    blocks: [
      { type: 'title', title: '雾中车站', text: '雾中车站' },
      {
        type: 'para',
        text: '凌晨一点半，雾把车站裹成一只茧。广播说：末班车已于二十分钟前离开。\n长椅上空无一人，只有售票窗口的灯还亮着。',
      },
      {
        type: 'rules',
        title: '售票窗口告示',
        text: '1. 本站末班车 23:00 发车。\n2. 雾天禁止在站台逗留。\n3. 如遇灰衣人问路，请回答「不知道」。',
      },
    ],
    choices: [
      { label: '在站台等下一班车', target: 'wait' },
      { label: '走向出口，走进雾里', target: 'exit' },
    ],
  },
  {
    id: 'wait',
    text: '你在站台边坐下，发现长椅角落有一把旧伞，伞下压着一张泛黄的时刻表。\n伞柄刻着三个字：「别回头」。\n（告示说雾天禁止在站台逗留——你已经在违反规则了。）',
    sfx: 'heartbeat',
    onEnter: {
      gain: ['旧伞'],
      set: { mood: 0 },
      gainDocs: ['d_schedule'],
      violation: ['r_stay'],
      day: 1,
      rand: [{ var: 'mood', min: 0, max: 1 }],
    },
    choices: [
      { label: '撑着伞，走向月台尽头', target: 'platform', when: { op: 'has', var: '旧伞' } },
      { label: '把伞放回原处，坐在长椅上等', target: 'bench' },
    ],
  },
  {
    id: 'bench',
    text: '你靠着长椅睡着了。\n醒来时，车站的铁门已经落下，售票窗口的灯熄了。',
    choices: [{ label: '（无可选择，只能等待）', target: 'lost' }],
  },
  {
    id: 'platform',
    text: '月台尽头的雾更浓了。雾里露出一扇铁门，锈迹斑斑，挂着「工作人员通道」的牌子。',
    choices: [
      { label: '推开铁门', target: 'door' },
      { label: '退回长椅', target: 'bench' },
    ],
  },
  {
    id: 'door',
    text: '通道里漆黑一片，只有滴水声。你撑开那把旧伞，伞骨上亮起幽蓝的微光。\n光在墙上照出一行字：「向前走，别回头。」',
    sfx: 'drone',
    fx: ['flicker'],
    onEnter: { flag: { lit: true }, add: { mood: 1 } },
    choices: [
      { label: '借着光向前走', target: 'dawn', when: { op: 'eq', var: 'lit', value: true } },
      { label: '退回站台', target: 'bench' },
    ],
  },
  {
    id: 'dawn',
    text: '你走了很久。光渐渐淡去，雾也淡了。\n推开通往地面的门，天已经亮了。你站在陌生的街道上，手里还握着那把旧伞——伞柄上的字变成了：「谢谢你。」',
    choices: [],
    ending: { id: 'e_dawn', title: '雾散天明', kind: 'good' },
  },
  {
    id: 'lost',
    text: '车站再也没有开门。你在长椅上等了很久很久。\n直到某一天，你发现候车室的镜子里，多了一个和你一模一样的人——他穿着你的衣服，坐在你坐过的位置。',
    choices: [],
    ending: { id: 'e_lost', title: '长椅上的影子', kind: 'bad' },
  },
  {
    id: 'exit',
    text: '雾里的路灯下站着一个灰衣人，像是一直在等你。\n他没有开口，只是抬手指了指你身后——售票窗口的灯，忽然亮了。',
    choices: [
      { label: '上前搭话', target: 'talk' },
      { label: '快步离开', target: 'gone' },
    ],
  },
  {
    id: 'talk',
    text: '「你错过了末班车。」灰衣人说，声音像从很远的地方传来。\n「这趟车，三年前就停运了。」你猛然回头——车站不见了，只剩一片空地，和雾。\n灰衣人已经转过身，走进雾里。他脚下，没有影子。',
    choices: [],
    ending: { id: 'e_secret', title: '旧车站', kind: 'true' },
  },
  {
    id: 'gone',
    text: '你快步走进雾里。雾很凉，像水一样贴在皮肤上。\n你走了很久，四周的雾却一直没有散。后来你不再走了，就站在那里，等雾散。\n雾一直没有散。',
    choices: [],
    ending: { id: 'e_lost', title: '长椅上的影子', kind: 'bad' },
  },
]

for (const node of nodes) {
  // 逐节点写入（此时剧情未建完，中途校验必然报断链，属正常；最后统一校验）
  const r = await tool('story_upsert_node', { title: '迷雾车站', node })
  if (!r.ok) {
    console.error('upsert 失败：', JSON.stringify(r))
    process.exit(1)
  }
}

// 3. 校验 + 全路径
const v = await tool('story_validate', { title: '迷雾车站' })
console.log('  validatePass:', v.validatePass)
console.log('  结局覆盖:', v.walk.endings.map((e) => `${e.endingId}(${e.paths}条路,${e.minSteps}步)`).join(' '))
console.log('  未到达:', v.walk.unreachableEndings.length === 0 ? '无' : v.walk.unreachableEndings)

// 4. 分支图
const g = await tool('story_graph', { title: '迷雾车站' })
console.log('  mermaid 行数:', g.mermaid.split('\n').length)

// 5. 导出
const e = await tool('story_export', { title: '迷雾车站' })
console.log('  导出:', e.outputPath, `(${e.sizeBytes} bytes, ${e.nodeCount} 节点, ${e.endingCount} 结局)`)

child.kill()
console.log('\nDEMO DONE')
