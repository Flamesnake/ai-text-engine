/**
 * ai-text-engine 数据模型（纯数据，可 JSON 序列化）。
 *
 * 设计目标：给 AI 用 —— 所有剧情都是 JSON 数据，AI 通过 MCP 工具读写，
 * 引擎负责求值、校验与渲染。
 */

/* ------------------------------ 基础类型 ------------------------------ */

/** 变量值：数字 / 字符串 / 布尔 */
export type VarValue = number | string | boolean

/** 运行时变量表 */
export type Vars = Record<string, VarValue>

/** 结局分类 */
export type EndingKind = 'good' | 'bad' | 'true' | 'hidden'

/* ------------------------------ 条件 DSL ------------------------------ */

/** 比较操作符 */
export type CondOp =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'exists'
  | 'has'
  | 'not_has'

/**
 * 条件表达式（选项的 when / 未来节点的门槛）。
 * 支持组合：and / or / not。
 * 规则：
 * - `has` / `not_has`：var 视为道具名，检查 inventory 是否包含；
 * - `exists`：检查变量是否已定义；
 * - 其余比较符：vars[var] 与 value 比较（数字按数值、字符串按 ===、布尔按 ===）。
 */
export interface Condition {
  var?: string
  op?: CondOp
  value?: VarValue
  and?: Condition[]
  or?: Condition[]
  not?: Condition
}

/* ------------------------------ 效果 ------------------------------ */

/**
 * 效果：进入节点（onEnter）或选择选项（effects）时对状态的一次性修改。
 */
export interface Effects {
  /** 直接赋值变量 */
  set?: Record<string, VarValue>
  /** 数值增减（对数字变量；不存在时从 0 起算） */
  add?: Record<string, number>
  /** 随机赋整数（含两端），如 rand: [{ var: '伤害', min: 3, max: 7 }] */
  rand?: { var: string; min: number; max: number }[]
  /** 记录违规（规则 id，去重进 GameState.violations；配合 #violated 条件） */
  violation?: string[]
  /** 推进天数（增量，默认 +1；负数为回退；最小 1） */
  day?: number
  /** 获得道具 */
  gain?: string[]
  /** 失去道具 */
  lose?: string[]
  /** 获得线索/文档（进入文档夹） */
  gainDocs?: string[]
  /** 获得证据（进入线索板；按 id 去重） */
  gainEvidence?: string[]
  /** 设置旗标（与 set 语义相同，仅作语义区分） */
  flag?: Record<string, boolean>
}

/* ------------------------------ 证据 / 推论 ------------------------------ */

export type EvidenceKind = 'document' | 'object' | 'testimony' | 'observation'

export interface Evidence {
  id: string
  title: string
  description: string
  kind?: EvidenceKind
  source?: string
}

export interface DeductionRequirement {
  /** 必须全部选中的证据 */
  all?: string[]
  /** 每组至少选中一条证据 */
  anyOf?: string[][]
}

export interface Deduction {
  id: string
  statement: string
  description?: string
  requires: DeductionRequirement
  /** 推论首次确认时生效 */
  onConfirmed?: Effects
}

/* ------------------------------ 文本块 / 文档线索 ------------------------------ */

/** 节点正文块类型（blocks 存在时优先于 text 渲染） */
export type TextBlockType = 'para' | 'title' | 'rules' | 'note' | 'letter'

export interface TextBlock {
  /** 块类型：para 段落 / title 标题 / rules 规则清单 / note 便条 / letter 信件 */
  type?: TextBlockType
  text: string
  /** 标题（title 类型必填，rules/letter 可带） */
  title?: string
}

/** 线索/文档定义（规则守则、便条、信件等可收集物） */
export interface StoryDocument {
  id: string
  title: string
  /** 展示类型：para 普通 / title 标题 / rules 规则 / note 便条 / letter 信件 / doc 文档（默认） */
  kind?: TextBlockType | 'doc'
  text: string
}

/* ------------------------------ 成就系统 ------------------------------ */

export interface Achievement {
  id: string
  title: string
  description: string
  /** 图标（简单 emoji） */
  icon?: string
  /** 达成前隐藏（解锁后才在列表中显示名称） */
  hidden?: boolean
  /**
   * 达成条件。除普通变量/道具条件外，支持特殊变量：
   * - `#steps`：已走步数（history 长度），与 value 数值比较；
   * - `#ending`：当前结局 id（eq/ne 比较）；
   * - `#visited`：是否访问过某节点，value 为节点 id（eq 已访问 / ne 未访问）。
   */
  when: Condition
}

/* ------------------------------ 风格系统 ------------------------------ */

/** 自定义主题配色（也可直接用内置主题名） */
export interface ThemeConfig {
  /** 页面背景（渐变色） */
  background: string
  /** 卡片背景 */
  card: string
  border: string
  borderGlow: string
  text: string
  textDim: string
  accent: string
  danger: string
  gold: string
  green: string
  purple: string
}

/** HUD 统计条（好感度/理智值等数值变量的可视化） */
export interface HudStat {
  /** 变量名（vars 中的数值键） */
  var: string
  /** 显示名，如「好感度」 */
  label: string
  /** 最大值（进度条满值），默认 100 */
  max?: number
  /** 大于该值时显示为满（避免溢出显示） */
  cap?: number
}

/* ------------------------------ 剧情模型 ------------------------------ */

export interface EndingMeta {
  id: string
  title: string
  kind: EndingKind
}

export interface Choice {
  /** 按钮文案（同样支持 {var} 插值） */
  label: string
  /** 目标节点 id */
  target: string
  /** 显示条件（不满足时选项被隐藏） */
  when?: Condition
  /** 选择本选项后生效 */
  effects?: Effects
}

export interface StoryNode {
  id: string
  /** 正文；支持 {varName} 插值与 \n 换行（blocks 存在时忽略 text） */
  text: string
  /** 分类型文本块（可选）：para/rules/note/letter/title 混合排版 */
  blocks?: TextBlock[]
  /** 进入本节点时播放的音效名：click/page/heartbeat/drone/achievement/shock/ending_* */
  sfx?: string
  /**
   * 卡片动画效果（进入节点后持续）：shake/flicker/glitch/pulse，
   * 或带参数的规格 { name, intensity?, speed? }：intensity 幅度倍率（0.3=轻微，2=剧烈），speed 频率倍率（2=快一倍，0.5=慢一倍），默认 1。
   */
  fx?: FxItem[]
  /** 选项；空数组 = 结局节点（必须带 ending） */
  choices: Choice[]
  /** 结局节点必须携带 */
  ending?: EndingMeta
  /** 进入本节点时生效（在正文渲染前应用） */
  onEnter?: Effects
  /** 供 AI/作者管理的标签（不影响游戏逻辑） */
  tags?: string[]
  /** 设计备注（仅开发用，不进入游戏渲染） */
  note?: string
}

/** 节点动画效果规格（fx 数组元素：效果名或带参数的规格） */
export interface FxSpec {
  name: 'shake' | 'flicker' | 'glitch' | 'pulse' | 'unstable'
  /** 幅度倍率（默认 1：原版幅度；0.3 = 轻微，2 = 剧烈） */
  intensity?: number
  /** 频率倍率（默认 1：原版周期；2 = 快一倍，0.5 = 慢一倍） */
  speed?: number
}

export type FxItem = FxSpec['name'] | FxSpec

export interface StoryMeta {
  title: string
  subtitle?: string
  version?: string
  author?: string
  /** 主题：内置主题名（'dark' | 'cyber' | 'cozy' | 'paper'）或自定义 ThemeConfig */
  theme?: string | ThemeConfig
  /** HUD 统计条（好感度等数值变量） */
  hud?: HudStat[]
}

export interface Story {
  meta: StoryMeta
  /** 起始节点 id */
  start: string
  /** 节点表 */
  nodes: Record<string, StoryNode>
  /** 结局表（与节点内 ending 一一对应） */
  endings: Record<string, EndingMeta>
  /** 成就表（可选） */
  achievements?: Achievement[]
  /** 线索/文档表（可选）：被 gainDocs 收集并可在文档夹查看 */
  documents?: Record<string, StoryDocument>
  /** 可收集并用于推理的证据 */
  evidence?: Record<string, Evidence>
  /** 玩家可通过证据组合确认的推论 */
  deductions?: Record<string, Deduction>
}

/* ------------------------------ 运行时状态 ------------------------------ */

export interface GameState {
  nodeId: string
  history: string[]
  /** 去重后的已访问节点（成就/条件用） */
  visited: string[]
  vars: Vars
  inventory: string[]
  /** 已获得的线索/文档 id */
  docs: string[]
  /** 已获得的证据 id */
  evidence: string[]
  /** 已确认的推论 id */
  deductions: string[]
  /** 已违反的规则 id（规则怪谈「违规度」） */
  violations: string[]
  /** 当前天数（规则怪谈「第几天」循环） */
  day: number
  /** 已解锁成就 id */
  achievements: string[]
  endingId: string | null
  updatedAt: number
}
