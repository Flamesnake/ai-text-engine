// 通过 ai-text-engine 的 MCP stdio 接口构建完整规则怪谈游戏。
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const title = '校史馆没有负一层'
const child = spawn(process.execPath, [path.join(root, 'dist/mcp/server.js')], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
})

let buffer = ''
let nextId = 0
const pending = new Map()
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  let cut
  while ((cut = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, cut).trim()
    buffer = buffer.slice(cut + 1)
    if (!line) continue
    const msg = JSON.parse(line)
    const job = pending.get(msg.id)
    if (!job) continue
    pending.delete(msg.id)
    msg.error ? job.reject(new Error(JSON.stringify(msg.error))) : job.resolve(msg.result)
  }
})
child.stderr.on('data', (chunk) => process.stderr.write(chunk))

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}

async function call(name, args) {
  const result = await rpc('tools/call', { name, arguments: args })
  const payload = JSON.parse(result.content[0].text)
  if (payload.ok === false) throw new Error(`${name}: ${JSON.stringify(payload)}`)
  return payload
}

await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'codex-rule-horror-builder', version: '1.0.0' },
})
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')

await call('story_new', {
  title,
  subtitle: '凌晨零点十七分以后，守则开始阅读你。',
  author: 'Codex × ai-text-engine',
})
await call('story_delete_node', { title, nodeId: 'end', force: true })
await call('story_delete_ending', { title, endingId: 'e_end' })
await call('story_set_meta', {
  title,
  theme: {
    background: 'radial-gradient(circle at 50% -20%, #251d27 0%, #090b0e 48%, #030405 100%)',
    card: '#101317ee', border: '#463943', borderGlow: '#8f213855', text: '#e8e0d5',
    textDim: '#948b83', accent: '#c23c4f', danger: '#ff5368', gold: '#c5a56a',
    green: '#6f9b7a', purple: '#8b6aa8',
  },
  hud: [
    { var: '自证', label: '自证', max: 6, cap: 6 },
    { var: '馆蚀', label: '馆蚀', max: 6, cap: 6 },
    { var: '记忆', label: '记忆', max: 5, cap: 5 },
    { var: '#day', label: '时段', max: 4, cap: 4 },
  ],
})

const documents = [
  { id: 'd_visitor', title: '夜间访客须知（红章）', kind: 'rules', text: '一、红灯亮时，逐字执行本须知；白灯亮时，执行每条规则的反面。\n二、不要向佩戴工牌的人说出姓名。\n三、零点十七分后，不要使用东侧楼梯。\n四、本馆没有负一层。若电梯显示 B1，请闭眼并按下 4。\n五、离馆前须把临时证投入回收箱。\n落款：校史馆夜间管理处（红墨）' },
  { id: 'd_staff', title: '值夜员交接册（蓝字）', kind: 'rules', text: '1. 访客守则第四条为馆方增补，绝不可按 4。\n2. 黑色电话第三次响起后必须接听；来电者若问姓名，以馆藏物名作答。\n3. 东库红灯并非火警，是“它”醒了。\n4. 纠错室只承认绿色签名。\n5. 蓝字属于馆，红字属于已归档者。' },
  { id: 'd_camera', title: '监控缺帧记录', kind: 'doc', text: '00:17:00，东库照明由白转红。\n00:17:03，走廊多出一名访客。\n00:17:04，该访客在此前三小时的画面中补齐。\n备注：镜头没有拍到“出现”，只拍到世界承认他一直存在。' },
  { id: 'd_child', title: '蜡笔画背面的童谣', kind: 'note', text: '妈妈用绿笔写名字，老师用黑笔点名字。\n馆里用蓝笔改名字，死人用红笔借名字。\n没有颜色的字，是我自己想起来的。' },
  { id: 'd_catalog', title: '1998 届失踪生名录', kind: 'doc', text: '沈缺，档案编号 98-071。照片栏留白。\n处分原因：擅自进入未竣工地下库。\n处理结果：姓名已从校史中纠正。\n经办人签名：沈岚（绿色墨水，笔迹与纠错室主任一致）。' },
  { id: 'd_maintenance', title: '货梯检修便条', kind: 'note', text: 'B1 不是楼层，是“未登记重量”的去处。货梯载到一个系统叫不出名字的人，才会显示 B1。\n下行时别报自己，报你带着的死物。\n上行时必须有人在馆内念出你的真名。' },
  { id: 'd_confession', title: '沈岚未寄出的信', kind: 'letter', text: '小缺：我签下纠错单，是想让馆里忘掉你，好让你从地下出来。可我只让世界忘了你。校史馆用被删除的名字填补缺页，而我成了它的值夜员。若有人携你的借阅卡来到井底，请他用绿色写回你的名字；也请他写回自己的。' },
  { id: 'd_protocol', title: '纠错协议第零条', kind: 'rules', text: '所有守则只对其落款者的利益负责。\n颜色不表示真假，只表示说话者：绿为人证，蓝为馆方，红为归档者，黑为尚未决定。\n当两条规则冲突，先问“谁希望我活着”，再问“谁希望我仍是我”。' },
  { id: 'd_roster', title: '今夜值班名册', kind: 'doc', text: '值夜员：沈岚。\n临时访客：________。\n附注：空白不是无人，空白是尚未被任何一方命名。' },
]
for (const document of documents) await call('story_upsert_document', { title, document })

const achievements = [
  { id: 'a_reader', title: '守则不是答案', description: '取得纠错协议第零条。', icon: '◈', when: { op: 'eq', var: '#docs', value: 'd_protocol' } },
  { id: 'a_nameless', title: '无名者', description: '在货梯中拒绝交出自己的名字。', icon: '□', hidden: true, when: { op: 'eq', var: '#visited', value: 'b1_archive' } },
  { id: 'a_violate', title: '必要的违规', description: '违反红章守则，却保住了人的身份。', icon: '✕', when: { op: 'eq', var: '#violated', value: 'r_press_b1' } },
  { id: 'a_truth', title: '缺席者作证', description: '抵达真正结局。', icon: '✒', hidden: true, when: { op: 'eq', var: '#ending', value: 'e_witness' } },
  { id: 'a_all_docs', title: '校史之外', description: '在一次游玩中收集至少八份文档。', icon: '▤', hidden: true, when: { op: 'gte', var: '#docs', value: 8 } },
  { id: 'a_loop', title: '熟悉的第一夜', description: '发现自己早已来过。', icon: '↻', hidden: true, when: { op: 'eq', var: '#ending', value: 'e_loop' } },
]
for (const achievement of achievements) await call('story_upsert_achievement', { title, achievement })

const nodes = [
  {
    id: 'start', text: '', sfx: 'drone', fx: ['flicker'],
    onEnter: { set: { 自证: 1, 馆蚀: 0, 记忆: 0, 电话响次: 0, 绿签: false, 知道颜色: false, 被念名: false } },
    blocks: [
      { type: 'title', title, text: '校史馆没有负一层' },
      { type: 'para', text: '暴雨封校。你来取一份能证明自己毕业的档案，却发现门厅电子钟永远停在 00:16。值夜员隔着磨砂玻璃递来一张空白临时证。她的工牌只剩一个姓：沈。' },
      { type: 'rules', title: '夜间访客须知（门厅摘录）', text: '红灯亮时照做，白灯亮时反着做。\n不要告诉工作人员姓名。\n本馆没有负一层。' },
      { type: 'note', text: '此刻顶灯是白色。玻璃后的女人没有抬头：“先决定，你要让谁替你写名字。”' },
    ],
    choices: [
      { label: '保持空白，只领取临时证', target: 'blank_pass', effects: { gain: ['空白临时证'], add: { 自证: 1 }, gainDocs: ['d_visitor'] } },
      { label: '用柜台的蓝笔填写真名', target: 'blue_name', effects: { add: { 馆蚀: 2 }, gainDocs: ['d_visitor'], violation: ['r_white_reverse'] } },
      { label: '在证件上写“校史馆”', target: 'object_name', effects: { gain: ['馆名临时证'], add: { 记忆: 1 } } },
    ],
  },
  { id: 'blue_name', text: '蓝墨渗进纸背。你明明写下两个字，抬头时却只记得姓氏。玻璃后的沈值夜员第一次看你：“馆里已经会叫你了。”', sfx: 'shock', fx: ['glitch'], choices: [
    { label: '追问她是谁', target: 'office', effects: { add: { 记忆: 1 } } },
    { label: '立刻去监控室确认自己何时进馆', target: 'security' },
  ] },
  { id: 'blank_pass', text: '扫描器连续报错：“未登记重量。”沈值夜员悄悄把一支绿色铅笔推到窗口边，又在监控转向前收回手。', choices: [
    { label: '拿走绿色铅笔，去值夜办公室', target: 'office', effects: { gain: ['绿色铅笔'], add: { 自证: 1 } } },
    { label: '不碰任何东西，去监控室', target: 'security' },
  ] },
  { id: 'object_name', text: '闸机认出了这张证，却没有认出你。门厅所有展柜同时发出轻微的呼吸声。临时证背面浮出蓝字：“持有人：本馆。”', fx: ['pulse'], choices: [
    { label: '撕掉临时证', target: 'paper_cut', effects: { lose: ['馆名临时证'], add: { 馆蚀: 1 }, violation: ['r_destroy_pass'] } },
    { label: '带着它进入监控室', target: 'security', effects: { add: { 馆蚀: 1 } } },
  ] },
  { id: 'paper_cut', text: '纸没有撕开，虎口却多出一道蓝色细线。你在废纸篓底看见一张儿童蜡笔画：没有脸的一家三口站在校史馆前。', choices: [
    { label: '收起蜡笔画', target: 'office', effects: { gainDocs: ['d_child'], add: { 记忆: 1 } } },
  ] },
  { id: 'office', text: '', sfx: 'page', blocks: [
    { type: 'para', text: '值夜办公室无人。桌上交接册摊在今天，却像被反复翻过几十年。黑色电话没有接线。墙上贴着今夜值班名册，访客栏是一道等待落笔的空线。' },
    { type: 'note', text: '交接册是蓝字。名册的附注是黑字。抽屉锁孔沾着绿色铅屑。' },
  ], onEnter: { gainDocs: ['d_staff', 'd_roster'] }, choices: [
    { label: '用绿色铅笔打开带绿色铅屑的抽屉', target: 'green_drawer', when: { op: 'has', var: '绿色铅笔' } },
    { label: '翻查 1998 届处分档案', target: 'catalog_room', effects: { add: { 记忆: 1 } } },
    { label: '电话第一次响起：接听', target: 'phone_one', effects: { set: { 电话响次: 1 }, violation: ['r_phone_third'], add: { 馆蚀: 1 } } },
    { label: '不接电话，去中央钟厅', target: 'clock_hall', effects: { set: { 电话响次: 1 } } },
  ] },
  { id: 'security', text: '十二块监控屏里，十一块显示你站在门厅；最后一块显示你背对镜头，已经在东库门前站了三小时。00:17 的缺帧记录被人压在键盘下。', onEnter: { gainDocs: ['d_camera'] }, choices: [
    { label: '相信实时画面：立刻赶往东库', target: 'clock_hall', effects: { add: { 馆蚀: 1 } } },
    { label: '倒放缺帧前一秒', target: 'camera_reverse', effects: { add: { 记忆: 1 } } },
    { label: '关闭显示你背影的屏幕', target: 'screen_dark', effects: { violation: ['r_observe'], add: { 自证: 1 } } },
  ] },
  { id: 'camera_reverse', text: '倒放时，画面中的“你”转过脸。那张脸属于一名穿旧校服的少年。胸牌上是：98-071。屏幕扬声器里，他倒着说：“灯色说的不是真假。”', fx: ['glitch'], choices: [
    { label: '记下编号，去查名录', target: 'catalog_room', effects: { add: { 记忆: 2 } } },
    { label: '把声音反向理解：颜色表示说话者', target: 'clock_hall', effects: { flag: { 知道颜色: true }, add: { 自证: 1 } } },
  ] },
  { id: 'screen_dark', text: '屏幕熄灭的瞬间，身后的椅子向下一沉，仿佛有人终于坐了下来。一个少年的声音贴着你耳后说：“谢谢。别让他们把我补回去。”', sfx: 'heartbeat', choices: [
    { label: '问他叫什么', target: 'catalog_room', effects: { add: { 记忆: 1 } } },
    { label: '不回头，去中央钟厅', target: 'clock_hall', effects: { add: { 自证: 1 } } },
  ] },
  { id: 'green_drawer', text: '绿铅笔恰好能拨开锁舌。抽屉内只有一份未寄出的信和一枚写着“98-071”的旧借阅卡。信纸潮湿，像刚从地下取出。', onEnter: { gainDocs: ['d_confession'], gain: ['98-071借阅卡'], flag: { 绿签: true }, add: { 记忆: 2 } }, choices: [
    { label: '把借阅卡夹进空白临时证', target: 'clock_hall', when: { and: [{ op: 'has', var: '空白临时证' }, { op: 'has', var: '98-071借阅卡' }] }, effects: { add: { 自证: 1 } } },
    { label: '只带走借阅卡', target: 'clock_hall' },
  ] },
  { id: 'catalog_room', text: '处分档案按“已经不存在的人”排列。98-071 的照片栏是一块比纸更白的空洞。档案末页，一行绿色签名仍未褪色。', onEnter: { gainDocs: ['d_catalog'] }, choices: [
    { label: '取走夹在名录里的借阅卡', target: 'clock_hall', effects: { gain: ['98-071借阅卡'], add: { 自证: 1 } } },
    { label: '用蓝笔补上少年的名字“沈缺”', target: 'replaced_end', effects: { add: { 馆蚀: 3 }, violation: ['r_blue_names'] } },
  ] },
  { id: 'phone_one', text: '听筒里只有你的呼吸。第二次铃声从听筒内部响起，像电话那端也有一部电话。一个声音问：“访客叫什么？”', sfx: 'heartbeat', choices: [
    { label: '说出自己的真名', target: 'name_taken_end', effects: { add: { 馆蚀: 4 }, violation: ['r_tell_name'] } },
    { label: '回答“98-071”', target: 'phone_two', when: { op: 'has', var: '98-071借阅卡' }, effects: { set: { 电话响次: 2 }, add: { 记忆: 1 } } },
    { label: '回答“空白临时证”', target: 'phone_two', when: { op: 'has', var: '空白临时证' }, effects: { set: { 电话响次: 2 }, add: { 自证: 1 } } },
    { label: '挂断，去钟厅', target: 'clock_hall', effects: { set: { 电话响次: 2 } } },
  ] },
  { id: 'phone_two', text: '对方接受了死物的名字。第三声铃终于从办公室的黑色电话本身响起。沈值夜员在门外轻声说：“这一次，该接。”', choices: [
    { label: '第三次响起后接听', target: 'protocol_room', effects: { set: { 电话响次: 3 }, add: { 自证: 1 } } },
    { label: '拔掉并不存在的电话线', target: 'loop_end', effects: { violation: ['r_phone_third'] } },
  ] },
  { id: 'protocol_room', text: '电话没有声音，听筒里却滑出一张折成细条的纸：《纠错协议第零条》。纸上没有落款，也没有颜色。你终于明白：守则从不承诺保护阅读者。', onEnter: { gainDocs: ['d_protocol'], flag: { 知道颜色: true }, add: { 记忆: 2, 自证: 1 } }, choices: [
    { label: '带着协议去中央钟厅', target: 'clock_hall' },
  ] },
  { id: 'clock_hall', text: '', sfx: 'drone', onEnter: { day: 1 }, blocks: [
    { type: 'para', text: '电子钟跳到 00:17。整座馆由白灯切成红灯。东侧楼梯传来向上的脚步声；电梯显示屏第一次出现 B1。沈值夜员站在两条路之间，绿色铅笔横在她掌心。' },
    { type: 'rules', title: '此刻你掌握的矛盾', text: '红章：不要走东侧楼梯；B1 不存在，出现时闭眼按 4。\n蓝册：红灯是“它”醒了；绝不可按 4。\n无色协议：先判断守则替谁说话。' },
  ], choices: [
    { label: '违反红章：睁眼按 B1', target: 'freight_test', effects: { violation: ['r_press_b1'], add: { 自证: 1 } } },
    { label: '遵守红章：避开东梯，闭眼按 4', target: 'floor_four', effects: { add: { 馆蚀: 2 } } },
    { label: '走东侧楼梯，寻找脚步声', target: 'east_stairs', effects: { violation: ['r_east_stairs'], add: { 记忆: 1 } } },
    { label: '要求沈值夜员替你决定', target: 'obedient_end', effects: { add: { 馆蚀: 2 } } },
  ] },
  { id: 'floor_four', text: '你闭眼按下 4。电梯上升了很久。开门后仍是门厅，只是展柜里陈列着你的书包、毕业照和一张写完的生平。最后一格还空着，尺寸刚好容纳你。', sfx: 'shock', choices: [
    { label: '接受馆方已经替你整理好一切', target: 'consumed_end', effects: { add: { 馆蚀: 4 } } },
    { label: '砸碎陈列柜，沿维修梯下行', target: 'freight_test', effects: { violation: ['r_damage'], add: { 自证: 1 } } },
  ] },
  { id: 'east_stairs', text: '脚步永远比你高一层。墙面消防图上，B1 被蓝漆盖住；刮开蓝漆，下面贴着货梯检修便条。楼梯拐角坐着监控里的少年，但你每眨一次眼，他就更像你。', onEnter: { gainDocs: ['d_maintenance'] }, choices: [
    { label: '把 98-071 借阅卡交给少年', target: 'boy_speaks', when: { op: 'has', var: '98-071借阅卡' }, effects: { lose: ['98-071借阅卡'], add: { 记忆: 1 } } },
    { label: '保留借阅卡，转入维修货梯', target: 'freight_test', when: { op: 'has', var: '98-071借阅卡' }, effects: { add: { 自证: 1 } } },
    { label: '承认他就是自己', target: 'replaced_end', effects: { add: { 馆蚀: 3 } } },
  ] },
  { id: 'boy_speaks', text: '少年接过卡片，五官终于停止向你靠拢。“我叫沈缺。”他说，“但你把唯一能写回我的东西还给了影子。”他指向楼下，“你还能救自己。”', choices: [
    { label: '独自离馆', target: 'escape_end', effects: { add: { 自证: 1 } } },
    { label: '追问井底发生了什么', target: 'freight_test', effects: { add: { 记忆: 1 } } },
  ] },
  { id: 'freight_test', text: '货梯要求输入“载荷名称”。红章要你闭眼，蓝册要你别按 4，检修便条则说：只有未登记的人能下到 B1。显示屏开始逐字拼出你遗忘的名字。', sfx: 'heartbeat', choices: [
    { label: '输入“98-071借阅卡”', target: 'b1_archive', when: { op: 'has', var: '98-071借阅卡' }, effects: { add: { 自证: 1 } } },
    { label: '输入“空白临时证”', target: 'b1_archive', when: { op: 'has', var: '空白临时证' }, effects: { add: { 自证: 1 } } },
    { label: '输入自己的真名', target: 'name_taken_end', effects: { add: { 馆蚀: 4 }, violation: ['r_tell_name'] } },
    { label: '什么也不输入，按 4 逃离', target: 'consumed_end', effects: { add: { 馆蚀: 3 } } },
  ] },
  { id: 'b1_archive', text: 'B1 没有房间，只有一口装满姓名卡的竖井。每张卡被抽走后，地面上就少一个“曾经存在的人”。井底中央是两张纠错单：沈缺，以及你。两张都缺少绿色签名。', sfx: 'drone', fx: ['pulse'], onEnter: { day: 1, add: { 记忆: 1 } }, choices: [
    { label: '先读井壁后的检修档案', target: 'well_archive', effects: { add: { 记忆: 1 } } },
    { label: '只签回自己的名字', target: 'self_signature', when: { op: 'has', var: '绿色铅笔' }, effects: { add: { 自证: 2 } } },
    { label: '把两张纠错单投入焚化口', target: 'burn_end', effects: { violation: ['r_destroy_records'] } },
    { label: '用蓝墨签下两个人的名字', target: 'replaced_end', effects: { add: { 馆蚀: 4 } } },
  ] },
  { id: 'well_archive', text: '井壁夹层记载着所有守则的修订痕迹。你找到检修便条的下半页，也找到沈岚被迫签署的第一份纠错协议。至此，每种颜色的主人都已开口。', onEnter: { gainDocs: ['d_maintenance', 'd_protocol'], flag: { 知道颜色: true }, add: { 记忆: 1 } }, choices: [
    { label: '用绿色铅笔同时写回沈缺和自己', target: 'double_signature', when: { and: [{ op: 'has', var: '绿色铅笔' }, { op: 'has', var: '98-071借阅卡' }, { op: 'eq', var: '知道颜色', value: true }, { op: 'gte', var: '记忆', value: 4 }] }, effects: { flag: { 绿签: true }, add: { 自证: 2 } } },
    { label: '只写回自己', target: 'self_signature', when: { op: 'has', var: '绿色铅笔' } },
    { label: '没有绿笔，只能用指血签名', target: 'blood_signature', effects: { add: { 馆蚀: 1 }, violation: ['r_red_signature'] } },
  ] },
  { id: 'double_signature', text: '绿字落下，井里所有红色姓名同时尖叫。货梯开始上升，但检修便条说：上行必须有人在馆内念出你的真名。沈岚隔着三层楼和二十八年，正在等你的选择。', sfx: 'heartbeat', choices: [
    { label: '通过黑色电话，让沈岚念出你的真名', target: 'witness_end', when: { and: [{ op: 'gte', var: '自证', value: 4 }, { op: 'gte', var: '记忆', value: 4 }] }, effects: { flag: { 被念名: true } } },
    { label: '让沈岚只念“沈缺”', target: 'escape_end' },
    { label: '自己念出自己的名字', target: 'name_taken_end', effects: { violation: ['r_tell_name'] } },
  ] },
  { id: 'self_signature', text: '你写回自己，沈缺的纠错单仍在井底。货梯上升时，一个少年的轮廓被留在门缝外。天亮后，你成功取回毕业档案，却再也记不起是谁引你来到这里。', choices: [], ending: { id: 'e_escape', title: '幸存者的缺页', kind: 'good' } },
  { id: 'blood_signature', text: '血是红色——属于已归档者。你的名字刚写完就从记忆里脱落。井中升起成千上万张卡片，为你腾出正中央的位置。', fx: ['glitch'], choices: [], ending: { id: 'e_consumed', title: '新增馆藏', kind: 'bad' } },
  { id: 'witness_end', text: '电话接通。沈岚先念“沈缺”，再完整念出你的名字。名字必须由另一个人见证，才不是馆藏编号。\n\n天亮时，校史馆的负一层第一次出现在建筑图上；1998 届毕业照里多回一个少年。沈岚在门口迅速衰老，又笑着把绿色铅笔交给你。\n\n你的毕业档案仍是一片空白。你没有补写——你已经不需要让一座馆证明你存在。', sfx: 'ending_true', fx: ['pulse'], choices: [], ending: { id: 'e_witness', title: '缺席者作证', kind: 'true' } },
  { id: 'escape_end', text: '有人被念回了世界，但不是所有人。你在晨光里走出校史馆，临时证在身后自行燃烧。多年以后，你偶尔会在合影的空隙里看见一个少年；他记得你，而你选择假装不认识。', sfx: 'ending_good', choices: [], ending: { id: 'e_escape', title: '幸存者的缺页', kind: 'good' } },
  { id: 'burn_end', text: '火焰吞掉两张纠错单，也吞掉“纠错”本身。井里所有名字一夜之间回到世界，挤进同一座城市、同一段历史、同一批家庭。黎明到来时，街上站满互相拥有矛盾记忆的人。你自由了——如果世界还容得下“你”。', sfx: 'ending_true', fx: ['shake'], choices: [], ending: { id: 'e_burn', title: '万人归档，万人还魂', kind: 'hidden' } },
  { id: 'consumed_end', text: '你踏进展柜，玻璃在身后合拢。说明牌缓慢打印：姓名、学号、生卒年，以及“自愿捐赠”。门厅恢复白灯。下一位访客推门进来时，你发现自己知道该递给他哪一支笔。', sfx: 'ending_bad', choices: [], ending: { id: 'e_consumed', title: '新增馆藏', kind: 'bad' } },
  { id: 'replaced_end', text: '蓝字完成了纠错。你走出馆门，所有人都认得你，但他们叫你沈缺。真正属于你的照片、朋友和过去，开始围绕这个新名字重新排列。你拥有完美的证明，却无法证明被证明的人是你。', sfx: 'ending_bad', fx: ['glitch'], choices: [], ending: { id: 'e_replaced', title: '被证明的陌生人', kind: 'bad' } },
  { id: 'name_taken_end', text: '馆内广播准确念出你的名字，一遍，两遍，三遍。第三遍以后，你不再是名字的主人。临时证变成借阅卡，状态一栏写着：“长期外借，逾期未还。”', sfx: 'ending_bad', choices: [], ending: { id: 'e_named', title: '名字的借阅期限', kind: 'bad' } },
  { id: 'loop_end', text: '你拔掉电话线，灯光熄灭。再亮起时，电子钟回到 00:16。玻璃后的沈值夜员递来一张空白临时证。她说出与你第一次进门时完全相同的话。\n\n只有废纸篓里的蜡笔画变了：没有脸的一家三口旁边，多了第四个人。', sfx: 'ending_bad', choices: [], ending: { id: 'e_loop', title: '熟悉的第一夜', kind: 'hidden' } },
  { id: 'obedient_end', text: '沈值夜员沉默很久，替你按下 4。“对不起，”她说，“服从的人最适合做值夜员。”电梯门再开时，玻璃后坐着你；门厅里站着她。她没有回头，走进雨幕，终于下班。', sfx: 'ending_bad', choices: [], ending: { id: 'e_obedient', title: '交接完成', kind: 'bad' } },
]

for (const node of nodes) await call('story_upsert_node', { title, node })

const validation = await call('story_validate', { title })
if (!validation.validatePass || validation.walk.unreachableEndings.length > 0) {
  throw new Error(`校验失败：${JSON.stringify(validation, null, 2)}`)
}
const graph = await call('story_graph', { title })
const exported = await call('story_export', { title })

console.log(JSON.stringify({
  title,
  nodeCount: validation.nodeCount,
  endingCount: validation.endingCount,
  endings: validation.walk.endings,
  maxDepth: validation.walk.maxDepth,
  simulatedStates: validation.walk.nodesVisited,
  warnings: validation.walk.warnings,
  graphLines: graph.mermaid.split('\n').length,
  outputPath: exported.outputPath,
  sizeBytes: exported.sizeBytes,
}, null, 2))
child.kill()
