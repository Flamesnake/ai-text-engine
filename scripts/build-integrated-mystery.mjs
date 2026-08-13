// 综合纵向切片：只通过 MCP 工具创作、校验并导出一部悬疑文字冒险。
// 用法：npm run build && node scripts/build-integrated-mystery.mjs
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const title = '雨夜遗嘱'
const child = spawn(process.execPath, [path.join(root, 'dist/mcp/server.js')], {
  stdio: ['pipe', 'pipe', 'pipe'],
})
child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`))

let buffer = ''
let nextId = 0
const pending = new Map()
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  let newline
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    const message = JSON.parse(line)
    const waiter = pending.get(message.id)
    if (!waiter) continue
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
    else waiter.resolve(message.result)
  }
})

const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    send({ jsonrpc: '2.0', id, method, params })
  })
}
async function tool(name, args) {
  const result = await request('tools/call', { name, arguments: args })
  const text = result?.content?.[0]?.text ?? ''
  if (result?.isError) throw new Error(`${name}: ${text}`)
  const parsed = JSON.parse(text)
  console.log(`${name}: ${parsed.ok ?? parsed.validatePass ?? 'ok'}`)
  return parsed
}

try {
  await request('initialize', {
    protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'integrated-mystery-builder', version: '1.0.0' },
  })
  send({ jsonrpc: '2.0', method: 'notifications/initialized' })

  await tool('story_new', {
    title,
    subtitle: '暴雨封住山路，而凶手仍在宅邸之中。',
    author: 'ai-text-engine vertical slice',
  })
  await tool('story_delete_node', { title, nodeId: 'end', force: true })
  await tool('story_delete_ending', { title, endingId: 'e_end' })
  await tool('story_set_meta', { title, theme: 'paper' })

  const characters = [
    {
      id: 'qiao', name: '乔岚', description: '死者的独子。外表轻佻，实际一直在追查父亲账目的漏洞。',
      relations: { trust: { label: '信任', initial: 0, min: -2, max: 3 } },
      secrets: { debt: { id: 'debt', title: '伪造欠条', description: '管家伪造赌债，逼他放弃继承权。' } },
    },
    {
      id: 'doctor', name: '许医生', description: '死者的私人医生。她隐瞒了一次错误诊断，因而害怕警方检查药物。',
      relations: { trust: { label: '信任', initial: 0, min: -2, max: 3 } },
      secrets: { misdiagnosis: { id: 'misdiagnosis', title: '旧日误诊', description: '半年前她误判过一次心绞痛，但今晚开的药没有问题。' } },
    },
    {
      id: 'mei', name: '梅姨', description: '照料宅邸二十年的女管家。她熟悉每一条暗廊，也知道管家周衡的习惯。',
      relations: { trust: { label: '信任', initial: 1, min: -2, max: 3 } },
      secrets: { outage: { id: 'outage', title: '停电中的脚步', description: '停电时，她听见周衡从药房方向跑回宴会厅。' } },
    },
  ]
  for (const character of characters) await tool('story_upsert_character', { title, character })

  const documents = [
    {
      id: 'portrait_note', title: '肖像背面的题字', kind: 'note',
      text: '“宅邸落成于一九〇七。唯有忠诚之人，才配保管我的账。”落款：乔致远。',
    },
    {
      id: 'medicine_sheet', title: '许医生的处方存根', kind: 'doc',
      text: '硝酸甘油片，每次一片，舌下含服。药瓶批号 X-17，封签为蓝色。',
    },
  ]
  for (const document of documents) await tool('story_upsert_document', { title, document })

  const evidence = [
    { id: 'swapped_bottle', title: '被调换的药瓶', description: '死者手边药瓶的批号并非 X-17，蓝色封签也是后来粘上的。', kind: 'object', source: 'body' },
    { id: 'ledger_page', title: '暗账残页', description: '周衡长期挪用庄园款项，并在今晚被主人要求次日交账。', kind: 'document', source: 'study_safe' },
    { id: 'son_testimony', title: '乔岚的证词', description: '停电前，乔岚看见周衡借口取蜡烛，拿走了主人的药瓶。', kind: 'testimony', source: 'qiao_confession' },
    { id: 'doctor_testimony', title: '许医生的证词', description: '死者发作时服下的药没有正常气味，瓶内应是无效糖片。', kind: 'testimony', source: 'doctor_confession' },
    { id: 'outage_footsteps', title: '停电脚步证词', description: '梅姨听见周衡在黑暗中从药房方向跑回宴会厅。', kind: 'testimony', source: 'mei_confession' },
  ]
  for (const item of evidence) await tool('story_upsert_evidence', { title, evidence: item })

  await tool('story_upsert_deduction', {
    title,
    deduction: {
      id: 'butler_murder',
      statement: '周衡利用停电调换救命药，并因暗账即将败露而杀人',
      description: '物证证明药瓶被换，暗账给出动机，目击或医学证词补全了作案过程。',
      requires: {
        all: ['swapped_bottle', 'ledger_page'],
        anyOf: [['son_testimony', 'doctor_testimony', 'outage_footsteps']],
      },
    },
  })

  await tool('story_upsert_puzzle', {
    title,
    puzzle: {
      id: 'study_safe', title: '书房暗格', actionLabel: '尝试打开肖像后的暗格',
      prompt: '黄铜转盘要求输入四位数字。肖像背后的题字似乎与密码有关。',
      kind: 'code', solution: '1907',
      hints: ['先检查书房里的主人肖像。', '题字强调的是宅邸落成年份。', '把“一九〇七”写成四位数字。'],
      onSolved: { gainEvidence: ['ledger_page'] },
    },
  })

  const nodes = [
    {
      id: 'start', text: '', sfx: 'drone',
      blocks: [
        { type: 'title', title: '雨夜遗嘱', text: '雨夜遗嘱' },
        { type: 'para', text: '午夜十一点，庄园主人乔致远死在自己的宴会桌前。暴雨冲垮了下山的桥，电话线也断了。你是今晚唯一的外客——一名受邀见证新遗嘱的调查记者。' },
        { type: 'note', title: '现场', text: '尸体旁有一只开着盖的心脏药瓶。停电持续了七分钟。宅邸里除你之外，只剩乔岚、许医生、梅姨，以及负责保管钥匙和账目的管家周衡。' },
      ],
      choices: [{ label: '封住大门，开始调查', target: 'hall' }],
    },
    {
      id: 'hall',
      text: '壁炉里的火逐渐变小。周衡站在楼梯旁，反复强调主人死于旧疾。其余三人各自沉默，等待你的判断。',
      choices: [
        { label: '检查尸体和药瓶', target: 'body' },
        { label: '与乔岚谈谈', target: 'qiao_talk' },
        { label: '询问许医生', target: 'doctor_talk' },
        { label: '请梅姨回忆停电经过', target: 'mei_talk' },
        { label: '调查二楼书房', target: 'study' },
        { label: '用完整证据指控周衡', target: 'true_ending', when: { op: 'eq', var: '#deduction', value: 'butler_murder' } },
        { label: '认定许医生用错药', target: 'false_ending' },
        { label: '接受“心脏病发”的说法，等待天亮', target: 'silent_ending' },
      ],
    },
    {
      id: 'body',
      text: '药瓶标签边缘有新鲜胶痕，瓶底批号也被刮花。你从许医生留在餐边柜上的处方存根确认：正确药瓶应是 X-17 批次，封签为蓝色。眼前这只不是。',
      onEnter: { gainEvidence: ['swapped_bottle'], gainDocs: ['medicine_sheet'] },
      choices: [{ label: '带着药瓶回到大厅', target: 'hall' }],
    },
    {
      id: 'qiao_talk',
      text: '乔岚捏着一张欠条，先承认自己与父亲争吵过。“你当然可以把我当凶手。所有人都知道我缺钱。”他却不肯解释停电时看见了什么。',
      choices: [
        {
          label: '指出欠条墨迹过新，答应先不公开', target: 'qiao_confession',
          when: { op: 'ne', var: '#memory', value: 'protected_qiao' },
          effects: { adjustRelation: [{ characterId: 'qiao', stat: 'trust', add: 2 }], remember: ['protected_qiao'] },
        },
        { label: '斥责他隐瞒事实', target: 'hall', effects: { adjustRelation: [{ characterId: 'qiao', stat: 'trust', add: -1 }] } },
        { label: '暂时结束谈话', target: 'hall' },
      ],
    },
    {
      id: 'qiao_confession',
      text: '确认走廊无人后，乔岚压低声音：“欠条是周衡伪造的。停电前，他说去取蜡烛，却顺手拿走了父亲的药瓶。我怕说出来后，没人会相信一个欠债的儿子。”',
      onEnter: { revealSecrets: ['qiao:debt'], gainEvidence: ['son_testimony'] },
      choices: [{ label: '记下证词，返回大厅', target: 'hall' }],
    },
    {
      id: 'doctor_talk',
      text: '许医生坚持自己的处方没有问题，却拒绝让你查看旧病历。她的手在发抖——不像杀人后恐惧，更像害怕另一件事被发现。',
      choices: [
        {
          label: '说明你只追查今晚的死因', target: 'doctor_confession',
          when: { op: 'ne', var: '#memory', value: 'reassured_doctor' },
          effects: { adjustRelation: [{ characterId: 'doctor', stat: 'trust', add: 2 }], remember: ['reassured_doctor'] },
        },
        { label: '威胁立刻公开全部病历', target: 'hall', effects: { adjustRelation: [{ characterId: 'doctor', stat: 'trust', add: -1 }] } },
        { label: '暂时结束谈话', target: 'hall' },
      ],
    },
    {
      id: 'doctor_confession',
      text: '许医生终于交出旧病历，承认半年前误诊过一次。但她也给出更关键的判断：“今晚他含下药片时，我就在旁边。真正的硝酸甘油有明显气味，那一片什么味道都没有。”',
      onEnter: { revealSecrets: ['doctor:misdiagnosis'], gainEvidence: ['doctor_testimony'] },
      choices: [{ label: '收好证词，返回大厅', target: 'hall' }],
    },
    {
      id: 'mei_talk',
      text: '梅姨说停电后大家都留在宴会厅，但说到周衡时，她下意识望向药房走廊。二十年的雇佣关系令她不愿轻易指控同僚。',
      choices: [
        {
          label: '告诉她，沉默只会让主人白死', target: 'mei_confession',
          when: { op: 'ne', var: '#memory', value: 'encouraged_mei' },
          effects: { adjustRelation: [{ characterId: 'mei', stat: 'trust', add: 1 }], remember: ['encouraged_mei'] },
        },
        { label: '尊重她的顾虑，稍后再问', target: 'hall' },
      ],
    },
    {
      id: 'mei_confession',
      text: '梅姨握紧围裙：“黑下来以后，我听见有人从药房那边跑回来。左脚拖地，是周衡的旧伤。我没看见脸，但那脚步我听了十几年。”',
      onEnter: { revealSecrets: ['mei:outage'], gainEvidence: ['outage_footsteps'] },
      choices: [{ label: '感谢她作证，返回大厅', target: 'hall' }],
    },
    {
      id: 'study',
      text: '书房没有被翻动。主人肖像悬在壁炉上方，画框却比墙面干净，显然经常被移动。画后嵌着一个四位数黄铜暗格。',
      puzzles: ['study_safe'],
      choices: [
        { label: '取下肖像，查看背面', target: 'portrait' },
        { label: '暗格已开，检查其中的残页', target: 'ledger_read', when: { op: 'eq', var: '#puzzle', value: 'study_safe' } },
        { label: '返回大厅继续调查', target: 'hall' },
      ],
    },
    {
      id: 'portrait',
      text: '肖像背面写着：“宅邸落成于一九〇七。唯有忠诚之人，才配保管我的账。”数字的墨迹被手指摩挲得发亮。',
      onEnter: { gainDocs: ['portrait_note'] },
      choices: [{ label: '记住题字，回到暗格前', target: 'study' }],
    },
    {
      id: 'ledger_read',
      text: '暗格里只剩半页账目。周衡连续三年把庄园修缮款转入私人账户。最后一行是主人的笔迹：“明早九点交账，否则报警。”动机与死亡时间终于重叠。',
      choices: [{ label: '带着账页返回大厅', target: 'hall' }],
    },
    {
      id: 'true_ending', text: '', sfx: 'ending_true',
      blocks: [
        { type: 'title', title: '七分钟的谋杀', text: '七分钟的谋杀' },
        { type: 'para', text: '你把假药瓶、暗账与证词依次摆上桌。周衡先否认挪款，再声称停电时从未离席——但这个谎言恰好把所有证据扣在一起。' },
        { type: 'para', text: '天亮时桥仍未修好。乔岚和梅姨用窗帘绳捆住周衡，许医生守着尸体。暴雨没有洗掉真相，只替你们争取了找出它的一夜。' },
      ],
      choices: [], ending: { id: 'e_truth', title: '七分钟的谋杀', kind: 'true' },
    },
    {
      id: 'false_ending',
      text: '你把许医生的隐瞒当成杀人证据。她承认旧日误诊，却无法证明自己今晚的清白。周衡在混乱中烧掉账页，第二天最先向警方“作证”。一个真实的秘密，替另一个更大的秘密挡住了光。',
      choices: [], ending: { id: 'e_false', title: '错误的处方', kind: 'bad' },
    },
    {
      id: 'silent_ending',
      text: '你接受了心脏病发的说法。清晨，周衡独自穿过刚能通行的便桥。数周后，乔岚收到银行的催款函，庄园账面只剩一个空壳。你这才明白，那一夜真正被带走的不只是一个人的生命。',
      choices: [], ending: { id: 'e_silence', title: '被雨冲走的真相', kind: 'bad' },
    },
  ]
  for (const node of nodes) await tool('story_upsert_node', { title, node })

  const achievements = [
    {
      id: 'a_listener', title: '让人开口', description: '获得任意一名知情人的信任', icon: '🕯️',
      when: { or: [
        { op: 'gte', var: '#relation:qiao:trust', value: 2 },
        { op: 'gte', var: '#relation:doctor:trust', value: 2 },
        { op: 'gte', var: '#relation:mei:trust', value: 2 },
      ] },
    },
    { id: 'a_truth', title: '遗嘱见证人', description: '在雨夜还原完整真相', icon: '🔍', hidden: true, when: { op: 'eq', var: '#ending', value: 'e_truth' } },
  ]
  for (const achievement of achievements) await tool('story_upsert_achievement', { title, achievement })

  const validation = await tool('story_validate', { title })
  if (!validation.validatePass || validation.walk.unreachableEndings.length > 0) {
    throw new Error(`最终校验失败：${JSON.stringify(validation, null, 2)}`)
  }
  const graph = await tool('story_graph', { title })
  const exported = await tool('story_export', { title })
  console.log(JSON.stringify({
    outputPath: exported.outputPath,
    nodeCount: exported.nodeCount,
    endingCount: exported.endingCount,
    paths: validation.walk.endings,
    graphLines: graph.mermaid.split('\n').length,
  }, null, 2))
} finally {
  child.kill()
}
