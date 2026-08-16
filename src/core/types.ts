/**
 * TaleSpindle 数据模型（纯数据，可 JSON 序列化）。
 *
 * 设计目标：给 AI 用 —— 所有剧情都是 JSON 数据，AI 通过 MCP 工具读写，
 * 引擎负责求值、校验与渲染。
 */

/* ------------------------------ 基础类型 ------------------------------ */

/** 变量值：数字 / 字符串 / 布尔 */
export type VarValue = number | string | boolean

/** 运行时变量表 */
export type Vars = Record<string, VarValue>

/** 运行时内置的短促音效；Schema 与合成器共享同一枚举。 */
export const SFX_NAMES = [
  'click', 'page', 'heartbeat', 'drone', 'achievement',
  'ending_good', 'ending_bad', 'ending_true', 'ending_hidden', 'shock',
] as const
export type SfxName = typeof SFX_NAMES[number]

/** 可跨节点持续的程序化环境声；与短促 sfx 分离。 */
export const SOUNDSCAPE_NAMES = [
  'rain', 'wind', 'storm', 'waves', 'broadcast',
  'electric', 'ventilation', 'engine', 'void',
] as const
export type SoundscapeName = typeof SOUNDSCAPE_NAMES[number]
export type SoundscapeIntensity = 'subtle' | 'medium' | 'strong'

export interface SoundscapeSpec {
  name: SoundscapeName
  /** 使用语义等级而非频率/音符参数，保持创作输入紧凑、安全。 */
  intensity?: SoundscapeIntensity
}

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
 * - `has` / `not_has`：普通 var 视为道具名；集合型特殊变量用 value 检查成员；
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
  /** 切换叙事世界/位面；值必须在 meta.world.states 中定义。 */
  world?: string
  /** 切换叙事阶段；值必须在 meta.phase.states 中定义。 */
  phase?: string
  /** 获得道具 */
  gain?: string[]
  /** 失去道具 */
  lose?: string[]
  /** 获得线索/文档（进入文档夹） */
  gainDocs?: string[]
  /** 获得证据（进入线索板；按 id 去重） */
  gainEvidence?: string[]
  /** 调整角色关系数值 */
  adjustRelation?: { characterId: string; stat: string; add: number }[]
  /** 记录关键行为记忆（作品级稳定 id） */
  remember?: string[]
  /** 揭示角色秘密，格式 characterId:secretId */
  revealSecrets?: string[]
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
  /** 证据不足时给玩家的非剧透调查方向。 */
  hint?: string
  requires: DeductionRequirement
  /** 推论首次确认时生效 */
  onConfirmed?: Effects
}

/* ------------------------------ 人物关系 ------------------------------ */

export interface RelationStatDefinition {
  label: string
  initial?: number
  min?: number
  max?: number
}

export interface CharacterSecret {
  id: string
  title: string
  description: string
}

export interface Character {
  id: string
  name: string
  description: string
  relations?: Record<string, RelationStatDefinition>
  secrets?: Record<string, CharacterSecret>
}

/* ------------------------------ 谜题 ------------------------------ */

export interface Puzzle {
  id: string
  title: string
  /** 场景中作为主要行动显示的文案；默认使用「解开：{title}」。 */
  actionLabel?: string
  prompt: string
  kind: 'code'
  solution: string
  caseSensitive?: boolean
  hints?: string[]
  requires?: Condition
  onSolved?: Effects
}

/* ------------------------------ 文本块 / 文档线索 ------------------------------ */

/** 节点正文块类型（blocks 存在时优先于 text 渲染） */
export type TextBlockType = 'para' | 'title' | 'rules' | 'note' | 'letter'

export type TextSegmentStyle =
  | 'emphasis'
  | 'italic'
  | 'blood'
  | 'whisper'
  | 'redacted'
  | 'glitch'
  | 'corrupt'
  | 'terminal'
  | 'handwritten'
  | 'broadcast'

/** 受控行内文字片段；不允许注入 HTML/CSS。 */
export interface TextSegment {
  /** 永远保存真实原文；遮挡和乱码只影响渲染。 */
  text: string
  style?: TextSegmentStyle
  /** 条件未满足时显示安全占位，满足后恢复真实文字。 */
  revealWhen?: Condition
}

export interface TextBlock {
  /** 块类型：para 段落 / title 标题 / rules 规则清单 / note 便条 / letter 信件 */
  type?: TextBlockType
  text: string
  /** 可选行内片段；存在时用于视觉渲染，text 保留纯文本回退。 */
  segments?: TextSegment[]
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

/** 高层视觉表达配置：少量可组合枚举替代重复 CSS，兼顾创作自由与 token 效率。 */
export interface PresentationConfig {
  /** 页面媒介/构图外壳。 */
  shell?: 'novel' | 'dossier' | 'chat' | 'cinematic'
  /** 字体性格；使用本地字体栈，保持单文件离线可用。 */
  typography?: 'literary' | 'modern' | 'mono' | 'rounded'
  density?: 'compact' | 'balanced' | 'spacious'
  shape?: 'sharp' | 'soft' | 'round'
  /** 选项的视觉隐喻。 */
  choiceStyle?: 'buttons' | 'list' | 'dialogue' | 'commands'
  /** 选项出现动画：无 / 依次淡入 / 依次上浮淡入。默认 fade；减弱动态偏好下自动关闭。 */
  choiceReveal?: 'none' | 'fade' | 'slide'
  /** 正文呈现方式：立即显示 / 逐字输出 / 仿终端逐字输出。默认 instant；点击或 Enter 可补全。 */
  textReveal?: 'instant' | 'typewriter' | 'terminal'
}

/** 拟态网页的站点外壳种类。 */
export type SiteKind = 'news' | 'forum' | 'blog' | 'mail'

/**
 * 站点视觉性格：同一外壳下的有限“不同站点”差异，避免模板感。
 * news: broadsheet/local/wire/tabloid；forum: classic/modern/terminal；
 * blog: folio/diary/editorial；mail: client/plain。
 */
export type SitePersona =
  | 'broadsheet' | 'local' | 'wire' | 'tabloid'
  | 'classic' | 'modern' | 'terminal'
  | 'folio' | 'diary' | 'editorial'
  | 'client' | 'plain'

/** 拟态网页的全局站点身份；页面导航继续复用节点 choices。 */
export interface SiteConfig {
  kind: SiteKind
  /** 站点抬头；与作品真实标题分离，避免一眼暴露游戏外壳。 */
  name: string
  tagline?: string
  /** 页眉中的短地区/频道标识，如“汐见町”。 */
  locale?: string
  /** 站点视觉性格；缺省时使用该外壳的默认版式。 */
  persona?: SitePersona
}

/** 页面布局：news 与 blog 的 article/post 是阅读页，forum 的 compose 与 mail 的 draft 是书写页。 */
export type WebPageLayout =
  | 'frontpage' | 'article' | 'bulletin'   // news
  | 'board' | 'thread' | 'compose'          // forum
  | 'index' | 'post' | 'archive'            // blog
  | 'inbox' | 'thread' | 'draft'            // mail（thread 与论坛共用枚举值）

/** 信息列表页（frontpage/board/index/inbox）的版面组合方式。 */
export type PageComposition = 'single' | 'lead-grid' | 'lead-grid-sidebar' | 'grid' | 'feed'

/** 当前节点在拟态网站中的页面语义；选项仍是唯一导航与剧情行动。 */
export interface WebPageMeta {
  layout?: WebPageLayout
  /** 列表页版面组合；只对 frontpage/board/index/inbox 生效。 */
  composition?: PageComposition
  section?: string
  headline?: string
  byline?: string
  timestamp?: string
}

/** world/phase 状态对应的受控表现覆盖；逻辑选项仍通过 #world/#phase 条件控制。 */
export interface StateAppearance {
  label?: string
  theme?: string | ThemeConfig
  presentation?: PresentationConfig
  soundscape?: SoundscapeSpec | 'silence'
}

export interface StateAxisConfig {
  /** 新游戏与旧存档迁移时使用的状态 id。 */
  initial: string
  states: Record<string, StateAppearance>
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

/** 选项在拟态网站列表页中的卡片呈现；不影响 when/effects/target 与路径逻辑。 */
export interface ChoiceCard {
  /** 列表页版面槽位。缺省时由 composition 与选项序号决定。 */
  slot?: 'lead' | 'grid' | 'sidebar' | 'feed'
  /** 卡片摘要；避免把正文复制到首页。 */
  summary?: string
  /** 程序化媒体占位：照片/文档/地图/图表/信号，不引入外部图片。 */
  media?: 'photo' | 'document' | 'map' | 'chart' | 'signal'
  /** 短标签，如“独家”“置顶”“未读”。 */
  badge?: string
}

export interface Choice {
  /** 按钮文案（同样支持 {var} 插值） */
  label: string
  /**
   * 选择后、目标节点正文前显示的即时承接。用于确认玩家行动与场景反应，
   * 尤其适合多个不同选择汇入同一节点时；支持与正文相同的变量插值。
   */
  response?: string
  /** 目标节点 id */
  target: string
  /** 显示条件（不满足时选项被隐藏） */
  when?: Condition
  /** 选择本选项后生效 */
  effects?: Effects
  /** 拟态网站列表页中的卡片元数据；纯表现，不产生第二路由。 */
  card?: ChoiceCard
}

/** 最近一次选择的叙事承接；属于展示状态，不参与路径逻辑。 */
export interface ChoiceTrace {
  fromNodeId: string
  targetNodeId: string
  label: string
  response?: string
}

/** 受控舞台背景；由运行时生成程序化布景，不依赖外部图片。 */
export type StageBackdrop = 'neutral' | 'interior' | 'exterior' | 'shore' | 'industrial' | 'archive' | 'void'
export type StageLighting = 'natural' | 'warm' | 'cool' | 'night' | 'alert' | 'blackout' | 'spotlight'
export type StageCamera = 'wide' | 'medium' | 'close' | 'push'
export type StagePosition = 'left' | 'center' | 'right'
export type StagePose = 'neutral' | 'open' | 'guarded' | 'tense' | 'afraid' | 'angry' | 'sad' | 'shadow'
export type StageEntrance = 'none' | 'fade' | 'slide' | 'rise'

export interface StageActorCue {
  /** 必须引用 story.characters 中的角色。 */
  characterId: string
  position: StagePosition
  pose?: StagePose
  /** 同一舞台最多一个焦点角色。 */
  focus?: boolean
  /** 本节点渲染时的一次性短入场；减弱动态模式下自动关闭。 */
  entrance?: StageEntrance
}

/**
 * 节点舞台差异 cue。对象会沿 history 持续并与此前 cue 合并；actors 数组整体替换。
 * `stage: "clear"` 显式撤下舞台。这样连续对白只需声明变化项。
 */
export interface StageCue {
  backdrop?: StageBackdrop
  lighting?: StageLighting
  camera?: StageCamera
  actors?: StageActorCue[]
}

export interface StoryNode {
  id: string
  /** 当前场景的一句话目标，帮助玩家理解下一步。 */
  objective?: string
  /** 正文；支持 {varName} 插值与 \n 换行（blocks 存在时忽略 text） */
  text: string
  /** 分类型文本块（可选）：para/rules/note/letter/title 混合排版 */
  blocks?: TextBlock[]
  /** 进入本节点时播放的内置音效。 */
  sfx?: SfxName
  /**
   * 声景切换点。对象会持续到后续节点再次声明；`silence` 显式淡出。
   * 未声明时沿用当前声景，避免逐节点重复配置。
   */
  soundscape?: SoundscapeSpec | 'silence'
  /**
   * 卡片动画效果（进入节点后持续）：shake/flicker/glitch/pulse，
   * 或带参数的规格 { name, intensity?, speed? }：intensity 幅度倍率（0.3=轻微，2=剧烈），speed 频率倍率（2=快一倍，0.5=慢一倍），默认 1。
   */
  fx?: FxItem[]
  /** 仅覆盖本场景与全局 presentation 不同的项；不要在每个节点重复全局配置。 */
  presentation?: PresentationConfig
  /** 受控舞台调度差异，或 clear 撤下舞台。 */
  stage?: StageCue | 'clear'
  /** 拟态网页页面元数据；不承载链接或剧情状态。 */
  page?: WebPageMeta
  /** 选项；空数组 = 结局节点（必须带 ending） */
  choices: Choice[]
  /** 可在本场景直接交互的谜题 id。未被任何节点绑定的旧谜题仍按全局谜题处理。 */
  puzzles?: string[]
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
  name: 'shake' | 'flicker' | 'glitch' | 'pulse' | 'unstable' | 'spotlight'
  /** 幅度倍率 0.1..2（默认 1：原版幅度；0.3 = 轻微，2 = 剧烈） */
  intensity?: number
  /** 频率倍率 0.25..4（默认 1：原版周期；2 = 快一倍，0.5 = 慢一倍） */
  speed?: number
  /** 仅 spotlight：光锥轻微摇晃。 */
  sway?: boolean
  /** 仅 spotlight：光锥不稳定闪烁。 */
  flicker?: boolean
}

export type FxItem = FxSpec['name'] | FxSpec

export interface StoryMeta {
  title: string
  /** 稳定存档标识（story_new 生成）；file:// 下同标题作品存档互不干扰。旧作品可缺省，跑时回退标题。 */
  uid?: string
  subtitle?: string
  version?: string
  author?: string
  /** 主题：内置主题名（'dark' | 'cyber' | 'cozy' | 'paper'）或自定义 ThemeConfig */
  theme?: string | ThemeConfig
  /** 全局视觉表达；未提供的维度使用可靠默认值。 */
  presentation?: PresentationConfig
  /** 可选拟态网站身份；页面导航继续复用节点 choices。 */
  site?: SiteConfig
  /** 新游戏的初始持续声景；节点可声明切换或 silence。 */
  soundscape?: SoundscapeSpec
  /** 表世界/里世界等叙事位面。 */
  world?: StateAxisConfig
  /** 白天/夜晚/警报/断电等叙事阶段。 */
  phase?: StateAxisConfig
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
  /** 结构化人物、关系维度与秘密 */
  characters?: Record<string, Character>
  /** 可交互谜题 */
  puzzles?: Record<string, Puzzle>
}

/* ------------------------------ 运行时状态 ------------------------------ */

export interface GameState {
  /**
   * 存档格式版本（SAVE_VERSION）；旧档缺省视为 v1。
   * 对存档做破坏性结构变更时 +1 并提供迁移（见 engine.migrateSave）。
   */
  saveVersion?: number
  nodeId: string
  /** 最近一次选择；仅在其目标为当前节点时显示 response。 */
  lastChoice: ChoiceTrace | null
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
  /** characterId -> stat -> value */
  relations: Record<string, Record<string, number>>
  /** 玩家关键行为记忆 */
  memories: string[]
  /** 已揭示秘密，格式 characterId:secretId */
  revealedSecrets: string[]
  /** 已解决谜题 id */
  solvedPuzzles: string[]
  /** 各谜题错误尝试次数 */
  puzzleAttempts: Record<string, number>
  /** 各谜题已揭示提示数 */
  puzzleHints: Record<string, number>
  /** 已看过的一次性机制教学 id。 */
  tutorialsSeen: string[]
  /** 已违反的规则 id（规则怪谈「违规度」） */
  violations: string[]
  /** 当前天数（规则怪谈「第几天」循环） */
  day: number
  /** 当前叙事世界与阶段；旧存档按 meta 中 initial 迁移。 */
  world: string
  phase: string
  /** 已解锁成就 id */
  achievements: string[]
  endingId: string | null
  updatedAt: number
}
