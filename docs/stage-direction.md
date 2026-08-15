# 受控舞台调度

TaleSpindle 的舞台调度用于增强对话、对质、告白、惊吓和结局等关键节点。它不是通用动画系统：Agent 只描述布景、灯光、镜头和人物站位，引擎负责生成离线、可访问、可测试的程序化演出。

## 数据格式

节点可声明 `stage`；未声明时沿用此前舞台，只发送变化项即可：

```jsonc
{
  "id": "confrontation",
  "text": "她终于把那封信放到桌上。",
  "stage": {
    "backdrop": "archive",
    "lighting": "spotlight",
    "camera": "push",
    "actors": [
      { "characterId": "lin", "position": "left", "pose": "guarded" },
      { "characterId": "zhou", "position": "right", "pose": "tense", "focus": true, "entrance": "fade" }
    ]
  },
  "choices": []
}
```

```ts
type StageCue = {
  backdrop?: 'neutral' | 'interior' | 'exterior' | 'shore' | 'industrial' | 'archive' | 'void'
  lighting?: 'natural' | 'warm' | 'cool' | 'night' | 'alert' | 'blackout' | 'spotlight'
  camera?: 'wide' | 'medium' | 'close' | 'push'
  actors?: Array<{
    characterId: string
    position: 'left' | 'center' | 'right'
    pose?: 'neutral' | 'open' | 'guarded' | 'tense' | 'afraid' | 'angry' | 'sad' | 'shadow'
    focus?: boolean
    entrance?: 'none' | 'fade' | 'slide' | 'rise'
  }>
}

type StoryNodeStage = StageCue | 'clear'
```

`characterId` 必须引用作品已有角色。每个 cue 最多三人，同一人物和同一站位不得重复，同时最多一人获得 `focus`。

## 持续、差异与撤台

- `backdrop`、`lighting`、`camera` 会沿节点历史持续；后续节点只写改变的字段。
- 一旦声明 `actors`，人物阵列整体替换；人物离场时发送新的较短阵列，而不是复制旧 cue 后逐项删除。
- `stage: "clear"` 清除全部舞台表现，后续恢复普通文字卡片。
- 存档恢复和结局页会按访问历史重建舞台，不建立独立剧情状态。
- `camera: "push"` 与人物 `entrance` 是一次性演出。进入下一节点后，镜头停在 `close`，入场动画不会重播。

## 使用原则

舞台调度适合承担一种明确叙事功能：建立空间、改变权力关系、把注意力移向某人，或标记不可逆转的时刻。普通调查和连续说明段落不必配置舞台。

建议每部 20–40 节点的作品只选择约 4–8 个舞台变化点。首次建台写完整 cue，之后只写差异；同一完整 cue 连续复制三次以上会被 `story_evaluate` 提示。这既减少视觉噪音，也减少 MCP 输入与修改 token。

### 温柔对话

```jsonc
{
  "stage": {
    "backdrop": "shore",
    "lighting": "warm",
    "camera": "wide",
    "actors": [
      { "characterId": "heroine", "position": "right", "pose": "open" }
    ]
  }
}
```

告白时只发送差异：

```jsonc
{
  "stage": {
    "camera": "close",
    "actors": [
      { "characterId": "heroine", "position": "center", "pose": "sad", "focus": true }
    ]
  }
}
```

### 恐怖对质

```jsonc
{
  "stage": {
    "backdrop": "void",
    "lighting": "alert",
    "camera": "push",
    "actors": [
      { "characterId": "witness", "position": "left", "pose": "afraid" },
      { "characterId": "shadow", "position": "right", "pose": "shadow", "focus": true, "entrance": "rise" }
    ]
  }
}
```

## 动画与可访问性边界

当前动画只包括固定的短促入场和镜头推进，不支持时间轴、骨骼动画、任意 CSS/JavaScript、外部视频或逐帧角色表演。系统启用“减弱动态效果”时，所有位移和入场动画会关闭，但布景、灯光、站位、姓名和姿态语义仍保留。

舞台是表现层，不得私藏证据、选项或结局条件。正文必须独立说明关键人物、行动与事实；没有动画、样式或视觉感知时，游戏仍应完整可玩。

## 何时继续扩展

只有至少两部不同题材作品证明现有枚举不足以表达反复出现的叙事需求，才增加新的背景、姿态或镜头。未来可考虑少量程序化天气、前后景层次与固定过场，但不会直接开放任意代码或完整舞台剧编辑器。
